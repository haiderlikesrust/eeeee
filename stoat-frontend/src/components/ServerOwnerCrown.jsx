import './ServerOwnerCrown.css';

/** Gold crown overlay for the current server's owner avatar (member list, messages, etc.). */
export default function ServerOwnerCrown({ size = 'member' }) {
  return (
    <span
      className={`server-owner-crown server-owner-crown--${size}`}
      title="Server owner"
      role="img"
      aria-label="Server owner"
    >
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path
          fill="currentColor"
          d="M5 16L3 8l4.5 3L12 5l4.5 6L21 8l-2 8H5z"
        />
        <path fill="currentColor" d="M4 18h16v3H4v-3z" />
      </svg>
    </span>
  );
}
