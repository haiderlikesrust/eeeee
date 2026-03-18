import { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import { useWS } from './WebSocketContext';

const VoiceContext = createContext(null);

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export function VoiceProvider({ children }) {
  const { on, send } = useWS();
  const [currentChannel, setCurrentChannel] = useState(null);
  const [voiceMembers, setVoiceMembers] = useState({});
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [sharingScreen, setSharingScreen] = useState(false);
  const [remoteScreenStreams, setRemoteScreenStreams] = useState({});
  const [cameraOn, setCameraOn] = useState(false);
  const [remoteCameraStreams, setRemoteCameraStreams] = useState({});
  const [speakingUserIds, setSpeakingUserIds] = useState(() => new Set());
  const [channelActiveSince, setChannelActiveSince] = useState({}); // channelId -> timestamp when channel became non-empty

  const peersRef = useRef(new Map());
  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const cameraStreamRef = useRef(null);
  const audioElementsRef = useRef(new Map());
  const audioStreamsRef = useRef(new Map()); // remoteUserId -> MediaStream for playback (keeps all received audio tracks)
  const speakingAnalyserRef = useRef(new Map()); // remoteUserId -> { intervalId, context }

  const cleanup = useCallback(() => {
    for (const [, data] of speakingAnalyserRef.current.entries()) {
      if (data.intervalId) clearInterval(data.intervalId);
      if (data.context) data.context.close().catch(() => {});
    }
    speakingAnalyserRef.current.clear();
    setSpeakingUserIds(new Set());

    for (const [, pc] of peersRef.current.entries()) {
      pc.close();
    }
    peersRef.current.clear();

    for (const [, audio] of audioElementsRef.current.entries()) {
      audio.pause();
      audio.srcObject = null;
    }
    audioElementsRef.current.clear();
    audioStreamsRef.current.clear();

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }

    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;
    }
    setSharingScreen(false);
    setCameraOn(false);
    setRemoteScreenStreams({});
    setRemoteCameraStreams({});
  }, []);

  const renegotiatePeer = useCallback((remoteUserId, channelId) => {
    const pc = peersRef.current.get(remoteUserId);
    if (!pc || pc.signalingState === 'closed' || pc.signalingState !== 'stable') return;
    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer).then(() => offer))
      .then((offer) => {
        send({
          type: 'VoiceSignal',
          targetUserId: remoteUserId,
          channelId,
          signal: { type: 'offer', sdp: offer },
        });
      })
      .catch(() => {});
  }, [send]);

  const createPeerConnection = useCallback((remoteUserId, channelId, isInitiator) => {
    if (peersRef.current.has(remoteUserId)) {
      peersRef.current.get(remoteUserId).close();
    }

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peersRef.current.set(remoteUserId, pc);

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        send({
          type: 'VoiceSignal',
          targetUserId: remoteUserId,
          channelId,
          signal: { type: 'ice-candidate', candidate: e.candidate },
        });
      }
    };

    const stopSpeakingDetection = (uid) => {
      const data = speakingAnalyserRef.current.get(uid);
      if (data) {
        if (data.intervalId) clearInterval(data.intervalId);
        if (data.context) data.context.close().catch(() => {});
        speakingAnalyserRef.current.delete(uid);
      }
      setSpeakingUserIds((prev) => {
        if (!prev.has(uid)) return prev;
        const next = new Set(prev);
        next.delete(uid);
        return next;
      });
    };

    pc.ontrack = (e) => {
      if (e.track?.kind === 'video') {
        const track = e.track;
        const nextStream = e.streams?.[0];
        const isCamera = track.label === 'camera';
        const setRemote = isCamera ? setRemoteCameraStreams : setRemoteScreenStreams;
        setRemote((prev) => {
          const prevStream = prev[remoteUserId];
          if (!nextStream || (prevStream && prevStream.id === nextStream.id)) return prev;
          return { ...prev, [remoteUserId]: nextStream };
        });
      }
      if (e.track?.kind === 'audio') {
        const track = e.track;
        const stream = e.streams?.[0];
        if (stream) {
          try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const source = ctx.createMediaStreamSource(stream);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.6;
            source.connect(analyser);
            const data = new Uint8Array(analyser.frequencyBinCount);
            const SPEAK_THRESHOLD = 25;
            const intervalId = setInterval(() => {
              if (!peersRef.current.has(remoteUserId)) return;
              analyser.getByteFrequencyData(data);
              let sum = 0;
              for (let i = 0; i < data.length; i++) sum += data[i];
              const avg = data.length ? sum / data.length : 0;
              const isSpeaking = avg > SPEAK_THRESHOLD;
              setSpeakingUserIds((prev) => {
                const has = prev.has(remoteUserId);
                if (isSpeaking === has) return prev;
                const next = new Set(prev);
                if (isSpeaking) next.add(remoteUserId);
                else next.delete(remoteUserId);
                return next;
              });
            }, 100);
            speakingAnalyserRef.current.set(remoteUserId, { intervalId, context: ctx });
          } catch (_) {}
        }
        // Use a single playback stream per peer and add every received audio track to it,
        // so renegotiation (e.g. screen share) never replaces the stream and drops audio.
        let playbackStream = audioStreamsRef.current.get(remoteUserId);
        if (!playbackStream) {
          playbackStream = new MediaStream();
          audioStreamsRef.current.set(remoteUserId, playbackStream);
        }
        if (track && !playbackStream.getAudioTracks().includes(track)) {
          playbackStream.addTrack(track);
        }
        let audio = audioElementsRef.current.get(remoteUserId);
        if (!audio) {
          audio = new Audio();
          audio.autoplay = true;
          audioElementsRef.current.set(remoteUserId, audio);
        }
        audio.srcObject = playbackStream;
        audio.play().catch(() => {});
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        stopSpeakingDetection(remoteUserId);
        const audio = audioElementsRef.current.get(remoteUserId);
        if (audio) {
          audio.pause();
          audio.srcObject = null;
        }
        audioElementsRef.current.delete(remoteUserId);
        audioStreamsRef.current.delete(remoteUserId);
        pc.close();
        peersRef.current.delete(remoteUserId);
        setRemoteScreenStreams((prev) => {
          if (!prev[remoteUserId]) return prev;
          const next = { ...prev };
          delete next[remoteUserId];
          return next;
        });
        setRemoteCameraStreams((prev) => {
          if (!prev[remoteUserId]) return prev;
          const next = { ...prev };
          delete next[remoteUserId];
          return next;
        });
      }
    };

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current);
      });
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => {
        track.label = 'screen';
        pc.addTrack(track, screenStreamRef.current);
      });
    }
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((track) => {
        track.label = 'camera';
        pc.addTrack(track, cameraStreamRef.current);
      });
    }

    if (isInitiator) {
      pc.createOffer().then((offer) => {
        pc.setLocalDescription(offer);
        send({
          type: 'VoiceSignal',
          targetUserId: remoteUserId,
          channelId,
          signal: { type: 'offer', sdp: offer },
        });
      }).catch(() => {});
    }

    return pc;
  }, [send]);

  const joinVoice = useCallback(async (channelId, channelName, serverId, serverName) => {
    if (currentChannel) {
      send({ type: 'VoiceLeave' });
      cleanup();
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;
    } catch (err) {
      console.error('Failed to get microphone:', err);
      return;
    }

    setCurrentChannel({ id: channelId, name: channelName, serverId, serverName });
    send({ type: 'VoiceJoin', channelId });
  }, [currentChannel, send, cleanup]);

  const leaveVoice = useCallback(() => {
    send({ type: 'VoiceLeave' });
    cleanup();
    setCurrentChannel(null);
  }, [send, cleanup]);

  const stopScreenShare = useCallback(() => {
    if (!screenStreamRef.current || !currentChannel) return;

    const screenTracks = new Set(screenStreamRef.current.getTracks());
    for (const [remoteUserId, pc] of peersRef.current.entries()) {
      for (const sender of pc.getSenders()) {
        if (sender.track && screenTracks.has(sender.track)) {
          pc.removeTrack(sender);
        }
      }
      renegotiatePeer(remoteUserId, currentChannel.id);
    }

    screenStreamRef.current.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    setSharingScreen(false);
  }, [currentChannel, renegotiatePeer]);

  const startScreenShare = useCallback(async () => {
    if (!currentChannel || sharingScreen) return;
    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      screenStreamRef.current = displayStream;
      setSharingScreen(true);

      const [screenTrack] = displayStream.getVideoTracks();
      if (screenTrack) {
        screenTrack.label = 'screen';
        screenTrack.onended = () => stopScreenShare();
      }
      for (const [remoteUserId, pc] of peersRef.current.entries()) {
        if (pc.signalingState === 'closed') continue;
        displayStream.getTracks().forEach((track) => pc.addTrack(track, displayStream));
        renegotiatePeer(remoteUserId, currentChannel.id);
      }
    } catch {}
  }, [currentChannel, sharingScreen, stopScreenShare, renegotiatePeer]);

  const stopCamera = useCallback(() => {
    if (!cameraStreamRef.current || !currentChannel) return;

    const cameraTracks = new Set(cameraStreamRef.current.getTracks());
    for (const [remoteUserId, pc] of peersRef.current.entries()) {
      for (const sender of pc.getSenders()) {
        if (sender.track && cameraTracks.has(sender.track)) {
          pc.removeTrack(sender);
        }
      }
      renegotiatePeer(remoteUserId, currentChannel.id);
    }

    cameraStreamRef.current.getTracks().forEach((t) => t.stop());
    cameraStreamRef.current = null;
    setCameraOn(false);
  }, [currentChannel, renegotiatePeer]);

  const startCamera = useCallback(async () => {
    if (!currentChannel || cameraOn) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      cameraStreamRef.current = stream;
      setCameraOn(true);

      stream.getVideoTracks().forEach((t) => { t.label = 'camera'; });

      for (const [remoteUserId, pc] of peersRef.current.entries()) {
        if (pc.signalingState === 'closed') continue;
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));
        renegotiatePeer(remoteUserId, currentChannel.id);
      }
    } catch {}
  }, [currentChannel, cameraOn, renegotiatePeer]);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const newVal = !prev;
      if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach((t) => { t.enabled = !newVal; });
      }
      return newVal;
    });
  }, []);

  const toggleDeafen = useCallback(() => {
    setDeafened((prev) => {
      const newVal = !prev;
      for (const audio of audioElementsRef.current.values()) {
        audio.muted = newVal;
      }
      if (newVal && !muted) {
        setMuted(true);
        if (localStreamRef.current) {
          localStreamRef.current.getAudioTracks().forEach((t) => { t.enabled = false; });
        }
      }
      if (!newVal && muted) {
        setMuted(false);
        if (localStreamRef.current) {
          localStreamRef.current.getAudioTracks().forEach((t) => { t.enabled = true; });
        }
      }
      return newVal;
    });
  }, [muted]);

  // Handle voice events from WS
  useEffect(() => {
    if (!on) return;

    const unsubReady = on('Ready', (data) => {
      if (data?.voiceStates) {
        setVoiceMembers(data.voiceStates);
        setChannelActiveSince((prev) => {
          const next = {};
          for (const [chId, members] of Object.entries(data.voiceStates)) {
            if ((members || []).length > 0) next[chId] = prev[chId] ?? Date.now();
          }
          return next;
        });
      }
    });

    const unsubState = on('VoiceStateUpdate', (data) => {
      if (!data) return;
      const members = data.members || [];
      setVoiceMembers((prev) => ({
        ...prev,
        [data.channelId]: members,
      }));
      setChannelActiveSince((prev) => {
        const next = { ...prev };
        if (members.length > 0) next[data.channelId] = prev[data.channelId] ?? Date.now();
        else delete next[data.channelId];
        return next;
      });
      if (data.action === 'leave' && data.userId) {
        setRemoteScreenStreams((prev) => {
          if (!prev[data.userId]) return prev;
          const next = { ...prev };
          delete next[data.userId];
          return next;
        });
        setRemoteCameraStreams((prev) => {
          if (!prev[data.userId]) return prev;
          const next = { ...prev };
          delete next[data.userId];
          return next;
        });
      }
    });

    const unsubVoiceReady = on('VoiceReady', (data) => {
      if (!data) return;
      // Create peer connections to existing members
      for (const memberId of (data.members || [])) {
        createPeerConnection(memberId, data.channelId, true);
      }
    });

    const unsubSignal = on('VoiceSignal', (data) => {
      if (!data) return;
      const { fromUserId, signal, channelId } = data;

      if (signal.type === 'offer') {
        // Use existing peer only when stable (e.g. renegotiation after they started screen share).
        // Creating a new PC on every offer would break the connection and drop audio.
        let pc = peersRef.current.get(fromUserId);
        if (!pc || pc.signalingState === 'closed' || pc.signalingState !== 'stable') {
          pc = createPeerConnection(fromUserId, channelId, false);
        }
        pc.setRemoteDescription(new RTCSessionDescription(signal.sdp)).then(() => {
          return pc.createAnswer();
        }).then((answer) => {
          pc.setLocalDescription(answer);
          send({
            type: 'VoiceSignal',
            targetUserId: fromUserId,
            channelId,
            signal: { type: 'answer', sdp: answer },
          });
        }).catch(() => {});
      } else if (signal.type === 'answer') {
        const pc = peersRef.current.get(fromUserId);
        if (pc) {
          pc.setRemoteDescription(new RTCSessionDescription(signal.sdp)).catch(() => {});
        }
      } else if (signal.type === 'ice-candidate') {
        const pc = peersRef.current.get(fromUserId);
        if (pc) {
          pc.addIceCandidate(new RTCIceCandidate(signal.candidate)).catch(() => {});
        }
      }
    });

    return () => {
      unsubReady();
      unsubState();
      unsubVoiceReady();
      unsubSignal();
    };
  }, [on, send, createPeerConnection]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return (
    <VoiceContext.Provider value={{
      currentChannel,
      voiceMembers,
      channelActiveSince,
      speakingUserIds,
      muted,
      deafened,
      sharingScreen,
      remoteScreenStreams,
      localScreenStream: screenStreamRef.current,
      cameraOn,
      remoteCameraStreams,
      localCameraStream: cameraStreamRef.current,
      joinVoice,
      leaveVoice,
      toggleMute,
      toggleDeafen,
      startScreenShare,
      stopScreenShare,
      startCamera,
      stopCamera,
    }}>
      {children}
    </VoiceContext.Provider>
  );
}

export function useVoice() {
  return useContext(VoiceContext);
}
