import Investigator from "./Investigator";

export default function Page() {
  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "32px 20px" }}>
      <h1 style={{ margin: 0, fontSize: 22 }}>Codebase Investigator</h1>
      <p style={{ color: "#9aa3b2", marginTop: 4, marginBottom: 20 }}>
        Paste a public GitHub URL, ask in plain English. Every answer ships with an independent audit.
      </p>
      <Investigator />
    </main>
  );
}
