This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Solvo — KeeperHub "The Last Mile" Hackathon Submission

Solvo is a conversational treasury execution agent: a payment instruction
becomes a validated, simulated, executed and independently provable Base USDC
transaction through KeeperHub.

- **Web:** https://solvo-beryl.vercel.app
- **Bot:** https://t.me/SolvoAgentBot
- **Submission doc:** `docs/submission.md` (proof links, judge test
  procedure, demo script, safety notes)
- **Judge Mode:** `docs/m6-judge-mode-deployment.md`

**Real proof links (Base mainnet, chain 8453):**

- M5 batch (2 recipients, 0.02 USDC aggregate):
  https://basescan.org/tx/0x94323245ce213e6038e7a0b937aa62a73d5b46af962c2509a00f688b38ac8dda
  and
  https://basescan.org/tx/0x9d7d9503dcc716bb6a9192d0e8f80bc9a7483c51c342f98f1f735e2422212071
- Final public self-serve judge proof (0.01 USDC):
  https://basescan.org/tx/0x81b61704780fa0d8a983bf15d01c6043ee7f42cd730499649de23137d932c25c

**Read-only verification:**

```bash
npm run m3:verify-proof   # M1/M3 direct execution proof
npm run m5:verify-proof   # M5 batch proof
npm run judge:verify-proof  # final public judge proof
npm run judge:doctor      # judge readiness (no payments)
```

No secrets appear in this repository.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
