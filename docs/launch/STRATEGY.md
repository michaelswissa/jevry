# Jevry: the seven-day launch plan

Research checked September 24, 2026. **10,000 stars in seven days is a stretch outcome, not a forecast or a deliverable.** The controllable objective is to make the product easy to understand, try, trust, and share, then convert feedback into visible improvements.

## What the evidence supports

GitHub documented Yarn reaching 10,000 stars by its second day. That establishes possibility, not a repeatable recipe: this was an exceptional launch with substantial existing distribution. [GitHub's historical launch analysis](https://github.blog/open-source/top-open-source-launches-on-github/)

The current READMEs of [Browser Use](https://github.com/browser-use/browser-use) and [Ollama](https://github.com/ollama/ollama), both established projects with more than 100,000 stars when checked, put product identity and a concrete way to start ahead of exhaustive internals. Our interpretation: borrow the clarity, demonstration, and quickstart, not their wording or implied traction. Stars alone do not establish that README design caused growth.

[Show HN](https://news.ycombinator.com/showhn.html) expects something people can try. [HN's general guidelines](https://news.ycombinator.com/newsguidelines.html) forbid soliciting votes and posting generated or AI-edited text. The founder must write their own HN submission and discussion; this launch kit intentionally does not supply copy to paste there.

[Product Hunt's launch guide](https://www.producthunt.com/launch) says preparation matters more than a magic weekday, makers can launch themselves, and asking directly for upvotes is prohibited. Product Hunt should follow a reliable try-it flow, not substitute for one.

[Reddiquette](https://support.reddithelp.com/hc/en-us/articles/205926439-Reddiquette) emphasizes authentic participation. Each subreddit also has its own rules. Post only where self-promotion is permitted, disclose authorship, and tailor the substance to the community. Do not scatter the same link across unrelated groups.

## The arithmetic

These are **planning scenarios, not measured Jevry conversion rates**:

| Repository visitor → star conversion | Visitors needed for 10,000 stars | Average visitors per day |
| --- | ---: | ---: |
| 2% | 500,000 | 71,429 |
| 5% | 200,000 | 28,572 |
| 10% | 100,000 | 14,286 |

At an assumed 1% social impression → repository visit rate and 5% visit → star rate, the target requires roughly **20 million relevant impressions**. Actual channels overlap, visitors repeat, and attribution is imperfect. This is why a README alone cannot promise the target.

## Positioning

**Jevry: your browser, ready to act.** A desktop browser that carries out tasks, researches sources, and plays supported games, with visible actions and an interruption control.

Lead with the real-time 2048 win. Immediately answer: what else does it do, how do I run it, what does it cost, and what are its limits? The video is a demonstration, not a general benchmark. Text and Jev connections are both required; make that explicit before installation.

## Seven days of work

| Day | Work | Evidence of progress |
| --- | --- | --- |
| 1 — launch | Publish the public repo, source preview release, real-time clip, quickstart, and one founder post. Stay available for setup questions. | Working public links; record starting stars and first installation reports. |
| 2 — remove friction | Reproduce the most common setup failure in a disposable profile. Ship and document a fix. Publish a short installation walkthrough. | Successful fresh setup, issue resolution, release notes. |
| 3 — technical depth | Explain observed DOM → Jev choice → guarded input. Share the architecture with relevant browser-agent developers where promotion is permitted. | Substantive feedback and reproducible bug reports. |
| 4 — everyday usefulness | Record a complete non-game task with visible inputs and outcome. Keep failed attempts in evaluation records. | One honest workflow demonstration beyond 2048. |
| 5 — product discovery | Launch on Product Hunt when setup is reliable and the founder can respond. Consider a personally written Show HN post under its current rules. | Actual accepted submission URLs, never assumed placement. |
| 6 — community | Triage issues, pair with interested contributors, and document a small contribution they can reproduce. Share genuine user outcomes with permission. | Useful PRs, successful reproductions, clearer docs. |
| 7 — report | Publish measured growth, installations where observable, known failures, fixes, and next priorities. | Transparent week-one report; no combined best-attempt benchmark. |

## Distribution priorities

1. **GitHub:** strong README, accurate topics, source release, public issues, private vulnerability reporting, and clear contribution paths.
2. **Founder LinkedIn / X:** native real-time clip, a plain explanation, one repository link, and a specific request for feedback. A voluntary GitHub star invitation is fine; never buy or exchange stars.
3. **Technical communities:** contribute a useful implementation explanation; follow local self-promotion rules. Relevant audiences are agent builders, Electron developers, and browser automation practitioners.
4. **Show HN:** founder-authored only, after checking rules and confirming people can try the project. Do not request votes or orchestrate engagement.
5. **Product Hunt:** honest preview positioning, available screenshots/demo, and a founder who can answer. No paid launch necessary.
6. **Curated lists/newsletters:** approach only those that accept submissions and match the project. Submit a factual description, not mass unsolicited mail or irrelevant PRs.

GitHub Trending is an outcome of discovery, not a placement we can book or guarantee. Do not spend money on bought stars, engagement pods, bots, or undisclosed promotion.

## Measurement and decision rules

Record daily timestamped GitHub star counts, traffic views/uniques, clones, referrers, issues, and PRs using repository Insights. Keep the original snapshots because traffic history is limited. Repo traffic is owner-visible; publish aggregates rather than private account details.

- High impressions, few visits: tighten the opening demonstration and the link placement.
- Visits, few attempts: remove installation ambiguity and surface provider requirements.
- Attempts, recurring setup failures: fix setup before amplifying distribution.
- Stars without usable feedback: ask for a specific reversible task and a reproducible result.

Success for the week includes an honest launch, real users trying the project, and resolved failures even if the star target is missed. Report the actual star count and dates; do not describe the target as achieved in advance.
