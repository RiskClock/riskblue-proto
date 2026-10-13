import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { mockBid, type MockVendor } from "@/lib/developerVendors";

export function BidComparison({ vendors, projectId, budget, onRemove }: { vendors: MockVendor[]; projectId: string; budget: number; onRemove: (id: string) => void }) {
  const bids = vendors.map(v => mockBid(projectId, v.id, budget));
  const rows = ["Bid status", "Total cost", "Equipment quoted", "Rental duration", "Treatments", "System status", "Bid analysis", "Submitted"];
  return <div className="overflow-x-auto">
    <table className="w-full min-w-[850px] table-fixed border-collapse text-left">
      <caption className="mb-6 text-left text-base text-muted-foreground">Sample bids · 5,000 sq ft space · Category 2 water</caption>
      <thead><tr><th className="w-44 border-b border-border px-4 py-6 font-medium">Bid comparison</th>{vendors.map(v => <th key={v.id} className="min-w-60 border-b border-border px-6 py-6 align-top">
        <div className="mb-5 flex h-24 items-center justify-between gap-3">{v.logo ? <img src={v.logo} alt={`${v.name} logo`} className="h-24 w-32 object-contain object-left" /> : <span className="font-serif text-3xl">{v.name[0]}</span>}<Button variant="ghost" size="icon" aria-label={`Remove ${v.name}`} onClick={() => onRemove(v.id)}><X /></Button></div>
        <p className="font-serif text-2xl font-medium">{v.name}</p>
      </th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={row}><th scope="row" className="border-b border-border px-4 py-6 align-top text-base font-medium">{row}</th>{bids.map((bid, i) => {
        let content: React.ReactNode = "Not provided";
        if (row === "Bid status") content = bid.status === "received" ? "Bid received" : bid.status === "awaiting" ? "Awaiting bid" : "Declined to bid";
        else if (bid.status === "received") {
          if (row === "Total cost") content = <span className="font-serif text-3xl tabular-nums">${bid.amount.toLocaleString("en-US")}</span>;
          if (row === "Equipment quoted") content = <div className="space-y-3"><p>{bid.airMovers} Air Movers</p><p>{bid.dehumidifiers} Dehumidifiers</p></div>;
          if (row === "Rental duration") content = `${bid.rentalDays} Days`;
          if (row === "Treatments") content = bid.treatment;
          if (row === "System status") content = <span className="flex items-start gap-2 font-medium"><span aria-hidden className={`mt-1 h-3 w-3 shrink-0 rounded-full bid-status-${bid.assessment}`} />{bid.systemStatus}</span>;
          if (row === "Bid analysis") content = bid.analysis;
          if (row === "Submitted") content = `${bid.submittedDays} ${bid.submittedDays === 1 ? "day" : "days"} ago`;
        }
        return <td key={vendors[i].id} className="break-words border-b border-border px-6 py-6 align-top text-base leading-relaxed">{content}</td>;
      })}</tr>)}</tbody>
    </table>
  </div>;
}