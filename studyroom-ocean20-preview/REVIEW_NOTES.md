# STUDY ROOM — Ocean View 2.0 design preview

## Purpose
An isolated visual/interaction prototype for one coast-themed study room. Not a public student launch. Based on `studyroom-v06d1-review-fixes/index.html`.

- **Preview:** https://gtmc-history.github.io/studyroom-ocean20-preview/
- **Source:** https://github.com/gtmc-history/gtmc-history.github.io/blob/main/studyroom-ocean20-preview/index.html
- **Baseline:** https://gtmc-history.github.io/studyroom-v06d1-review-fixes/

## What's implemented
- Initial scene is public room 3 (coast); school-room 2 also displays the upgraded coast theme.
- Original, procedurally painted 1024×512 seascape via CanvasTexture (no third-party photos, models, stock music, or additional network hosts). Beach deck, lighthouse, layered water, distant sail, birds, waves, and gently moving curtains.
- 12 existing selectable seats with independent numeric IDs and solo/shared desks; existing Supabase anonymous authentication, seat RPCs, study event history unchanged.
- Ocean desk lamps respond visually to occupied/studying/break state.
- On sitting down, the camera blends toward a selected desk. When entering a break, the camera turns to the panorama. When resuming, it returns to the desk. Finishing resets to room view.
- Separate compact, coast-only controls: Ocean / Desk / Room / optional procedural wave sound. Audio **starts only after an explicit user click**, is silent by default, and stops on leaving the coast or pagehide.
- Other room themes unchanged. DB schemas and operational v0.5.2, v0.6-B, v0.6-C, v0.6-D, v0.6-D.1 files untouched.

## Code checks completed
- The GitHub file was fetched and inline JavaScript parsed successfully (syntax).
- Compared production-relevant `rpc('...')` call names against v0.6-D.1: same ten RPC names; no new DB RPC or SQL.
- Simulated 1200×800 and 390×844 layouts across five public themes + coast school room + return to coast (14 cases): all 12 seats retained, each 0..11 ID still unique. Approx. 13 ocean animation elements.
- Simulated camera transitions for seating IDs 0/5/11 in both viewports. Desk camera stays approximately 1.86m high inside the room; ocean viewing camera approximately 1.85m high.
- Mock resource-count test: current coast room retains two textures (one sign, one canvas panorama); other rooms retain one sign texture. Previous rooms' textures and geometry were released in the mock. Mock results are **not live WebGL GPU metrics**.

## NOT tested or claimed
- The actual public GitHub Pages URL could not be loaded from the assistant's web-fetch environment. Availability may depend on Pages deployment propagation.
- No real browser screenshot, touch device, or actual GPU FPS benchmark performed here.
- Real Supabase login/seat/timer regression and simultaneous user cross-device load not newly tested for this prototype.
- Privacy, school Realtime access control and multi-user launch gates from earlier reviews remain open.

## Suggested headless/browser checks
1. Compare screenshot of v0.6-D.1 vs Ocean View 2.0 for public-3 at desktop 1200×800 and mobile 390×844.
2. Check panoramic horizon visibility, lamp/beam/curtain occlusion, clipping, object depth ordering, and window sides.
3. At seats 0, 5, and 11, sit → camera focus and lamp brighten → break → safe ocean view → resume → desk view → finish → overview, using a mock Supabase first.
4. Check that desk-focus button becomes enabled **after walking/arrival** and disabled once the seat is released.
5. Enter/exit coast repeatedly (20 cycles); compare `renderer.info.memory.textures`, `renderer.info.memory.geometries`, and draw calls. A 1-texture higher coast baseline is expected due to the panorama.
6. Test mobile horizontal/vertical drag, two-finger pinch, and UI overlap; test eco mode and portrait orientation.
7. Finally, with user approval, one real Supabase short session and a refresh, verifying continuity of recorded time.

## Safety and copyright
Original geometry, procedural image and synthesized ambient sound. No secret keys added. Public Turnstile site key remains unchanged; never publish the Turnstile Secret Key.
