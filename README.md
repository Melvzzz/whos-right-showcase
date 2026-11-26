# Who’s Right?

Who’s Right? is an iOS app for structured one-on-one debates. Two people take timed turns, and an AI pipeline checks factual claims against web sources, scores the arguments, and gives each participant feedback on their reasoning.

I designed, built, and launched it solo. The app reached **1,000+ App Store downloads** across five major releases. I orchestrated more than 40 n8n workflows and brought turn analysis below 15 seconds. The service was paused in April 2026.

[Product walkthrough and screenshots](https://melvinzerigue.com/work/whos-right)

## Start with the code

| If you want to see | Open |
| --- | --- |
| The in-person duel, with two people sharing a phone | [Local duel screen](app/screens/debates/LocalDuelGameScreen.tsx) |
| Turn-taking when players are available at different times | [Asynchronous debate screen](app/screens/debates/AsyncDebateScreen.tsx) |
| How the backend calls n8n and processes analysis and coaching responses | [n8n service](api/src/n8n/n8n.service.ts) |
| How the backend handles our in-person debate flow | [Local debate service](api/src/local-debates/local-debates.service.ts) |
| How debate scores are applied | [Scoring service](api/src/scoring/scoring.service.ts) |

The mobile code uses React Native, Expo and TypeScript. The backend uses NestJS, Prisma, PostgreSQL and Redis.

This repository is a source snapshot for code review. Running the full product requires the rest of the application, its assets, and separately configured services.
