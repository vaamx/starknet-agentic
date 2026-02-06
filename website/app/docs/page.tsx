import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Documentation | Starknet Agentic",
  description:
    "Documentation for Starknet Agentic - The infrastructure layer for AI agents on Starknet.",
};

export default function DocsPage() {
  return (
    <main className="min-h-screen bg-cream">
      <div className="section-padding py-20">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-4xl md:text-5xl font-heading font-bold text-neo-dark mb-6">
            Documentation
          </h1>
          <p className="text-xl text-neo-dark/70 mb-8">
            Coming soon. Documentation for Starknet Agentic is currently being
            developed.
          </p>
          <div className="neo-card p-8">
            <p className="text-neo-dark/80">
              In the meantime, check out our{" "}
              <a
                href="https://github.com/keep-starknet-strange/starknet-agentic"
                className="text-neo-purple hover:text-neo-purple/80 underline underline-offset-2"
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub repository
              </a>{" "}
              for the latest information and guides.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
