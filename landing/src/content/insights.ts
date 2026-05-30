export type InsightCard = {
  body: string;
  date: string;
  href: string;
  image?: string;
  title: string;
  type: string;
};

export const insightCards: InsightCard[] = [
  {
    body: "Ever wondered why TypeScript feels so seamless with your favorite JavaScript libraries? Definitely Typed changed how the ecosystem ships type safety.",
    date: "Mar 26",
    href: "https://www.callstack.com/podcasts/how-definitely-typed-changed-typescript-forever",
    title: "How Definitely Typed Changed TypeScript Forever",
    type: "Podcast",
  },
  {
    body: "On-device speech synthesis is now available in the AI SDK for React Native, using Apple's local speech APIs for private audio generation.",
    date: "Aug 21",
    href: "https://www.callstack.com/blog/on-device-text-to-speech-on-apple-devices-with-ai-sdk",
    title: "On-Device Text To Speech on Apple Devices with AI SDK",
    type: "Article",
  },
  {
    body: "Learn how to run on-device LLMs in React Native using Vercel's AI SDK and local providers built for mobile privacy and low latency.",
    date: "Dec 5",
    href: "https://www.callstack.com/events/the-offline-ai-on-device-llms-in-react-native-with-ai-sdk",
    title: "The Offline AI: On-Device LLMs in React Native With AI SDK",
    type: "Talk",
  },
  {
    body: "Szymon Rybczak shows how to run LLMs directly inside React Native apps using React Native AI and an AI SDK provider architecture.",
    date: "Nov 28",
    href: "https://www.callstack.com/events/how-to-run-any-llm-on-device-with-react-native",
    title: "How to Run Any LLM On-Device With React Native",
    type: "Talk",
  },
];
