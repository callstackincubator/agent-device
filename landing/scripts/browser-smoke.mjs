import { execFileSync } from "node:child_process";

const baseUrl = process.env.LANDING_SMOKE_URL ?? "http://127.0.0.1:4311";
const session = `landing-smoke-${Date.now()}`;
const pages = ["/", "/agentic-qa", "/agentic-development"];
const viewports = [
  ["desktop", 1440, 1200],
  ["tablet", 834, 1200],
  ["mobile", 390, 1000],
];

function run(args) {
  return execFileSync("agent-browser", ["--session", session, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function evalJson(script) {
  const output = JSON.parse(run(["eval", `JSON.stringify(${script})`]));
  return typeof output === "string" ? JSON.parse(output) : output;
}

const failures = [];

try {
  for (const [label, width, height] of viewports) {
    run(["set", "viewport", String(width), String(height)]);

    for (const page of pages) {
      const url = new URL(page, baseUrl).toString();
      run(["open", url]);
      run(["wait", "--load", "networkidle"]);

      const result = evalJson(`(() => {
        const navText = document.querySelector('nav')?.textContent ?? "";
        const h1 = document.querySelector('h1')?.textContent?.trim() ?? "";
        const bodyText = document.body.textContent ?? "";
        const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
        const cloudLinks = Array.from(document.querySelectorAll('a[href="/cloud"], a[href="#cloud"]'))
          .map((link) => link.textContent?.trim() ?? link.getAttribute('href'));
        const figmaImages = Array.from(document.images)
          .filter((img) => decodeURIComponent(img.currentSrc || img.src).includes('/figma/'))
          .map((img) => decodeURIComponent(img.currentSrc || img.src));

        return {
          h1,
          overflow,
          navHasCloud: /Cloud/i.test(navText),
          cloudLinks,
          hasCloudPricingCopy: /device-minutes|Self-serve|Free tier/i.test(bodyText),
          nonOptimizedVisuals: figmaImages.filter((src) => !/\\.(webp|png|svg)([&?]|$)/.test(src)),
        };
      })()`);

      if (!result.h1) {
        failures.push(`${label} ${page}: missing h1`);
      }

      if (result.overflow > 1) {
        failures.push(`${label} ${page}: horizontal overflow ${result.overflow}px`);
      }

      if (result.navHasCloud) {
        failures.push(`${label} ${page}: Cloud appears in primary navigation`);
      }

      if (result.cloudLinks.length) {
        failures.push(`${label} ${page}: public page exposes Cloud links`);
      }

      if (result.hasCloudPricingCopy) {
        failures.push(`${label} ${page}: public page exposes Cloud pricing copy`);
      }

      if (result.nonOptimizedVisuals.length) {
        failures.push(
          `${label} ${page}: unexpected image URLs ${result.nonOptimizedVisuals.join(", ")}`,
        );
      }
    }
  }
} finally {
  try {
    run(["close"]);
  } catch {
    // Best-effort cleanup; failures above should remain the useful signal.
  }
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log(`Browser smoke passed for ${pages.length} pages across ${viewports.length} viewports.`);
