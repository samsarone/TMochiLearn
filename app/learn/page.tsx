import type { Metadata } from "next";
import Home from "../page";

export const metadata: Metadata = {
  title: "Learn — tMochi",
  description: "Explore interactive educational stories and choose your own path through every lesson.",
};

export default function LearnPage() {
  return <Home catalogMode="learn" />;
}
