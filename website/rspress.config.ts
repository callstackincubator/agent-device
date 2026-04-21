import { defineConfig } from '@rspress/core';
import { withCallstackPreset } from '@callstack/rspress-preset';

export default withCallstackPreset(
  {
    context: __dirname,
    docs: {
      title: 'agent-device',
      description:
        'CLI for mobile UI automation, logs, network inspection, and performance diagnostics for AI agents',
      editUrl: 'https://github.com/callstackincubator/agent-device/edit/main/website',
      rootUrl: 'https://incubator.callstack.com/agent-device',
      rootDir: 'docs',
      icon: '/logo.svg',
      logoLight: '/logo-light.svg',
      logoDark: '/logo-dark.svg',
      ogImage: '/og-image.jpg',
      socials: {
        github: 'https://github.com/callstackincubator/agent-device',
        discord: 'https://discord.gg/eYapw6F3',
      },
    },
    theme: {
      content: {
        outlineCTAHeadline: 'Curious about developing mobile apps with AI agents?',
        outlineCTADescription: 'We can help you take your agentic workflows to the next level and ship faster.',
        outlineCTAButtonText: "Book a call",
      },
    },
  },
  defineConfig({
    base: process.env.RSPRESS_BASE || '/agent-device',
  }),
);
