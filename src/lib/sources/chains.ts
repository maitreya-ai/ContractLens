export interface Chain {
  id: number;
  name: string;
  explorer?: string;
}

/** Chains offered in the UI. Sourcify and Etherscan V2 both key contracts by chain ID. */
export const CHAINS: Chain[] = [
  { id: 1, name: "Ethereum", explorer: "https://etherscan.io" },
  { id: 8453, name: "Base", explorer: "https://basescan.org" },
  { id: 42161, name: "Arbitrum One", explorer: "https://arbiscan.io" },
  { id: 10, name: "OP Mainnet", explorer: "https://optimistic.etherscan.io" },
  { id: 137, name: "Polygon PoS", explorer: "https://polygonscan.com" },
  { id: 56, name: "BNB Smart Chain", explorer: "https://bscscan.com" },
  { id: 43114, name: "Avalanche C-Chain", explorer: "https://snowtrace.io" },
  { id: 100, name: "Gnosis", explorer: "https://gnosisscan.io" },
  { id: 59144, name: "Linea", explorer: "https://lineascan.build" },
  { id: 534352, name: "Scroll", explorer: "https://scrollscan.com" },
  { id: 10143, name: "Monad Testnet" },
  { id: 11155111, name: "Sepolia", explorer: "https://sepolia.etherscan.io" },
  { id: 84532, name: "Base Sepolia", explorer: "https://sepolia.basescan.org" },
];

export function chainName(id: number | null | undefined): string {
  if (id == null) return "";
  return CHAINS.find((c) => c.id === id)?.name ?? `Chain ${id}`;
}

export function explorerUrl(chainId: number | null, address: string | null): string | null {
  const chain = CHAINS.find((c) => c.id === chainId);
  return chain?.explorer && address ? `${chain.explorer}/address/${address}#code` : null;
}

export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
