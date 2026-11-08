import type { Metadata } from "next";
import PatientCallScreen from "@/components/PatientCallScreen";

export const metadata: Metadata = { title: "Still Kicking · Your check-in call" };

export default async function PatientPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PatientCallScreen slug={slug} />;
}
