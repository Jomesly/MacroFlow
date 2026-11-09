import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import MarketDetailPage from '@/components/market/MarketDetailPage';
import { isMarketSymbol } from '@/lib/market/symbols';
import { referenceCharts } from '@/lib/market/instruments';

type Props = { params: Promise<{ symbol: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { symbol } = await params;
  if (!isMarketSymbol(symbol)) return { title: 'Market not found | MacroFlow' };
  return {
    title: `${symbol} analysis | MacroFlow`,
    description: `Fundamental bias, scored drivers, daily bias history and upcoming releases for ${referenceCharts[symbol].name}.`,
  };
}

export default async function MarketPage({ params }: Props) {
  const { symbol } = await params;
  if (!isMarketSymbol(symbol)) notFound();
  // A new symbol owns a fresh request lifecycle; old responses cannot replace it.
  return <MarketDetailPage key={symbol} symbol={symbol} />;
}
