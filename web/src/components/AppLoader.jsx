import BrandMark from './BrandMark';

export default function AppLoader({ message = 'Opening Circolife Maps' }) {
  return (
    <div className="app-loader" role="status" aria-live="polite">
      <div className="app-loader-orbit" aria-hidden>
        <svg className="app-loader-infinity" viewBox="0 0 88 44" fill="none">
          <path
            className="app-loader-loop"
            d="M22 22c0-8.8 7.2-16 16-16 7.2 0 12.2 4.8 16 11.2C57.8 10.8 62.8 6 70 6c8.8 0 16 7.2 16 16s-7.2 16-16 16c-7.2 0-12.2-4.8-16-11.2C50.2 33.2 45.2 38 38 38c-8.8 0-16-7.2-16-16Z"
            stroke="currentColor"
            strokeWidth="5.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <BrandMark />
      <p className="app-loader-copy">{message}</p>
    </div>
  );
}
