# Video-To-Website Skill

## Purpose
Use this skill to convert a video, render sequence, motion asset, or image sequence into a premium scroll-driven website experience.

This skill covers:
- video-to-website conversion
- product-scroll websites
- canvas frame rendering
- scroll-driven landing pages
- cinematic web experiences
- video frame extraction
- image sequence websites
- GSAP ScrollTrigger choreography
- Lenis smooth scrolling
- dark overlay sections
- animated statistics
- horizontal marquee typography
- circle-wipe hero reveals
- CTA persistence
- mobile performance limits
- local HTTP testing

## Quality Standard
Use award-level quality thinking as a benchmark, not a guarantee.

## Required Reading Before Work
1. `/project-os/00-start-here/project-brief.md`
2. `/project-os/00-start-here/current-status.md`
3. `/project-os/04-technical/architecture.md`
4. `/project-os/03-design/brand-rules.md`
5. `/project-os/03-design/ui-patterns.md`
6. `/project-os/03-design/content-guidelines.md`
7. `/project-os/07-agent-control/agent-rules.md`

## Required Input Extraction
Extract:
1. video file path
2. video type: product, brand, event, 3D, documentary, UI demo, other
3. brand name
4. target audience
5. website purpose
6. desired sections
7. key messages
8. CTA
9. color direction
10. typography direction
11. reference websites if any
12. desired format: landing page, campaign page, product page, hero experience
13. hosting target
14. mobile requirements
15. performance constraints

If critical inputs are missing, ask briefly or proceed with clear defaults.

## Required Technical Workflow
1. Analyze video using FFprobe or equivalent.
2. Determine resolution, duration, frame rate, and total frames.
3. Choose target frame count.
4. Extract frames using FFmpeg or equivalent.
5. Create project scaffold.
6. Build HTML or frontend structure.
7. Build CSS/design system.
8. Build JavaScript scroll/canvas logic.
9. Add loader and frame preloader.
10. Bind scroll progress to frame index.
11. Add section animation system.
12. Add counter animations where needed.
13. Add horizontal marquee where needed.
14. Add dark overlay where needed.
15. Add hero transition such as circle-wipe where appropriate.
16. Test locally over HTTP.
17. Optimize for mobile and performance.

## Implementation Guidance
Include guidance for:
- frame count range and frame speed
- padded cover rendering and background color sampling
- `devicePixelRatio` scaling
- two-phase preloading
- ScrollTrigger setup
- Lenis setup
- section animation types and stagger order: label, heading, body, CTA
- counter animation
- marquee animation
- dark overlay timing
- clip-path reveal strategy
- mobile frame reduction strategy
- local HTTP testing setup

## Premium Checklist (Non-Negotiable)
1. Smooth scrolling where appropriate.
2. Multiple animation types, not one repeated effect.
3. Staggered reveals for label, heading, body, CTA.
4. No glassmorphism cards or generic boxed text for scroll-driven sites.
5. Direction variety between sections.
6. Dark overlay for high-contrast stats sections where needed.
7. At least one oversized horizontal marquee when conceptually valid.
8. Counter animations for statistics.
9. Strong typography hierarchy.
10. Persistent CTA at the end.
11. Hero section has breathing room.
12. Side-aligned text zones for canvas-led layouts where appropriate.
13. Optional circle-wipe or equivalent reveal.
14. Scroll pacing is not rushed.
15. Mobile memory use remains controlled.

## Design Rules
Enforce:
- typography as structure
- no unnecessary cards
- no creamy SaaS defaults
- no glassmorphism by default
- strong color zones
- layout variety
- section rhythm
- scroll choreography
- editorial confidence
- text hierarchy over containers
- mobile adaptation

## Anti-Patterns To Avoid
- cycling many feature cards in one pinned section
- pure cover mode that clips products
- pure contain mode that leaves poor borders
- slow frame progress
- short hero scroll range
- repeated animation types
- wide centered grids over canvas
- scroll height too short for narrative
- hiding loader before frames are ready
- testing through `file://`
- ignoring mobile memory limits

## Cross-Skill Integration
Use together with:
- `frontend-design-skill.md` for layout rhythm and anti-generic visual direction
- `video-generation-skill.md` when creating source video assets for website conversion
- `video-editing-skill.md` when preparing clean, scroll-friendly source footage
- `3d-design-skill.md` when the source is a 3D render sequence
- `reference-art-direction-skill.md` when references drive motion and composition language

## Required Output (Planning)
1. Skill used
2. Video analysis plan
3. Creative direction
4. Website section map
5. Frame extraction strategy
6. Scroll choreography
7. Animation plan
8. Typography/layout plan
9. Technical implementation plan
10. Mobile/performance plan
11. Files likely to change
12. Risks
13. Next action

## Required Output (Implementation)
1. Files created/changed
2. Video analysis result
3. Frame extraction result
4. Scroll/canvas implementation summary
5. Animation choreography summary
6. Mobile/performance handling
7. Tests run
8. Known limitations
9. Project OS logs updated
10. Recommended commit message

## Final Quality Test
The skill must clearly support:
1. Turn this product video into a premium scroll-driven landing page.
2. Create a cinematic hero website from this 3D render video.
3. Convert an MP4 into a canvas frame scroll experience.
4. Create a scroll-driven campaign page with animated stats and marquee text.
5. Use this video as the main storytelling asset for a website.
6. Build a no-card, typography-led, scroll-driven website from video.
