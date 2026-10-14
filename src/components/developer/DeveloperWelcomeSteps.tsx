const STEPS = [
  { title: "Define Project", body: "Set your target protection level and upload (or delegate) project drawings." },
  { title: "AI Threat Extraction", body: "RiskBlue securely analyzes your drawings to extract a standardized list of risk areas." },
  { title: "Select Vendors", body: "Review the threat summary and send bid requests to recommended specialists." },
  { title: "Receive Bids", body: "Vendors review the extracted risk areas and submit itemized proposals." },
  { title: "Evaluate & Award", body: "Compare incoming bids side-by-side and select the best partner for your build." },
];

export function DeveloperWelcomeSteps() {
  return (
    <div className="mt-8 overflow-x-auto pb-3">
      <ol className="grid min-w-[960px] grid-cols-5 gap-6">
        {STEPS.map((step, index) => (
          <li key={step.title} className="border-t border-border pt-4">
            <span className="font-serif text-3xl text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
            <h3 className="mt-3 text-base font-semibold text-foreground">{step.title}</h3>
            <p className="mt-2 text-base leading-relaxed text-muted-foreground">{step.body}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}