import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { post } from '../api';
import './RoomPage.css';

export default function RoomJoinPage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await post(`/rooms/join-code/${code}`);
        if (!cancelled && res?.room?._id) {
          navigate(`/rooms/${res.room._id}`, { replace: true });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err?.error || 'Could not join room. It may have been closed.');
          setJoining(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [code, navigate]);

  if (joining) {
    return (
      <div className="room-page room-page--loading">
        <div className="room-loading-text">Joining room...</div>
      </div>
    );
  }

  return (
    <div className="room-page room-page--closed">
      <div className="room-closed-card">
        <h2>Cannot Join</h2>
        <p>{error}</p>
        <button className="room-btn room-btn-primary" onClick={() => navigate('/channels/@me')}>
          Back to Home
        </button>
      </div>
    </div>
  );
}
