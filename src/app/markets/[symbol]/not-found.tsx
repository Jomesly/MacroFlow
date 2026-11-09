import Link from 'next/link';

export default function MarketNotFound() {
  return (
    <main id="main-content" className="market-research market-missing">
      <h1>Market not found</h1>
      <p>Choose Gold, GBP/USD, Nasdaq 100, Dow Jones 30 or Bitcoin from the market overview.</p>
      <Link href="/" className="research-action">Back to markets</Link>
    </main>
  );
}
