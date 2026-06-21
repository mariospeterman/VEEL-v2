import Link from "next/link";
import { notFound } from "next/navigation";
import { legalDocLabels, legalDocs, type LegalDocSlug } from "../../legal-docs";

export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  if (!isLegalDocSlug(slug)) {
    notFound();
  }

  return (
    <main className="legal-page-shell">
      <article className="legal-page-document">
        <p>WeVid legal</p>
        <h1>{legalDocLabels[slug]}</h1>
        <p>{legalDocs[slug]}</p>
        <Link href="/">Back to landing</Link>
      </article>
    </main>
  );
}

function isLegalDocSlug(slug: string): slug is LegalDocSlug {
  return slug in legalDocs;
}
