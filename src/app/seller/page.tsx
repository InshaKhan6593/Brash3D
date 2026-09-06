import { SellerPanel } from "@/components/seller-panel"

export default async function SellerPage({ searchParams }: PageProps<"/seller">) {
  const { sessionId } = await searchParams
  return <SellerPanel sessionId={typeof sessionId === "string" ? sessionId : null} />
}
