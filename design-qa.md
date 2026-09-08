# Loading Screen Design QA

**Source visual truth**

- `/var/folders/7m/q0fk4_gx6ps0x8m0chhtjdsh0000gn/T/codex-clipboard-40c631f2-4bae-4534-8222-c79d0e9d9e36.png`
- Source composite: 874 × 858 px; each app screen is approximately 390 × 844 CSS px at 1×.

**Implementation evidence**

- Light: `/private/tmp/bw-loading-light-pass2.png`
- Dark: `/private/tmp/bw-loading-dark-pass2.png`
- Side-by-side normalized comparison: `/private/tmp/bw-loading-comparison-pass2.png`
- Simulator: iPhone 17 Pro, 402 × 874 pt, screenshots 1206 × 2622 px at 3×.
- Normalization: implementation captures downsampled to 390 × 848 px and center-cropped to 390 × 844 px before comparison.
- State: theme hydration loading state. A temporary development-only delay was used to keep the state visible for capture and was removed afterward.

**Full-view comparison evidence**

- Fonts and typography: system font, 20 pt regular title, 14 pt secondary/loading/footer copy; hierarchy matches the source. The loading copy intentionally differs because the user changed it to `正在载入`.
- Spacing and layout rhythm: the centered content group and footer align with the source after the pass-1 vertical adjustment.
- Colors and visual tokens: light `#FFFFFF` and dark `#071829` backgrounds, primary/secondary text, and status-bar contrast match the design tokens.
- Image quality and asset fidelity: the existing BlackWave logo asset is used at 88 pt without replacement or approximation.
- Copy and content: `寰澜`, `正在载入`, and `BLACKWAVE · 经营与财务智能工作台` are present.

**Focused-region comparison evidence**

- A separate crop was not needed: the normalized 390 px full-view comparison keeps the 88 px logo, 20 px title, 14 px copy, and 34 px loader clearly readable.

**Findings and iteration history**

1. Pass 1 — P2: center stack was about 36 pt too high. Fixed by applying a 36 pt vertical translation to the content group.
2. Pass 1 — P2: the platform spoke indicator differed from the source's 34 pt, 3 pt-border ring. Fixed with a native `Animated.View` ring using theme border and action colors.
3. Pass 1 — P3: the dark logo lacked the source's thin white outline. Fixed with a 1 pt dark-mode border.
4. Pass 2 — verified: clean light and dark simulator captures were compared side-by-side with the source. No P0, P1, or P2 visual issues remain. The status-bar hardware treatment differs because the implementation was captured on an iPhone 17 Pro with Dynamic Island; app-owned content remains aligned after viewport normalization.

**Implementation checklist**

- [x] Apply source dimensions, colors, typography, logo, footer, and user-approved copy.
- [x] Correct the pass-1 vertical position, loader shape, and dark logo outline.
- [x] Remove the temporary capture delay from production code.
- [x] Resolve the mobile merge conflicts and capture pass 2 in both themes.

final result: passed
