# OpenWiz top bar · round 1 image prompts

Generation route was the built-in `image_gen` tool with `transparent_background: false` and the ordered local image references listed below. The route returned image files without a model identifier.

The selected images are resized to 1440 × 900 or 390 × 844 for 1× review. Earlier generations are retained in the working copy under `targets/r1-iterations/`. Reference paths below are relative to the design inputs or working copy.

The painted red Wiz in each selected image is recognizable, but the generator rendered its own version of the supplied PNG. Header metrics, colors, and the hero treatment are visual approximations.

## A-desktop · attempt 1

References in tool order

- `inputs/wiz-official-256.png`
- `inputs/baseline/home-desktop.png`
- `inputs/refs/desktop-sheet.png`

```text
Use case: ui-mockup. Create a sharp screenshot-style design target for the OpenWiz landing-page top bar.
Reference 1 is the exact transparent official painted red Wiz asset. Place this asset unchanged, downscaled with its true colors and silhouette, including the hooked red hat and gold star, two large pale eyes, toothy grin, waving red hand, and red-and-gold robe. Do not draw a new mascot or use the cream silhouette from the baseline. Reference 2 is the OpenWiz baseline and provides the existing warm-dark ground and hero styling. Reference 3 provides UI restraint, spacing, and hierarchy cues only. No reference brand names, imagery, borders, or logos from the sheet belong in the output.
Use flat ground #1b1916 throughout the viewport, Geist and Geist Mono styling, primary text #f3eee8 and secondary text #c8c0b8. Product wordmark exactly OpenWiz. Exactly one viewport, edge to edge, no margins outside the artboard, no reference comparison, no labels identifying direction. All visible words and icons crisp and legible at 1×. No invented copy.
One 1440 × 900 landscape full-bleed flat browser viewport image, with no frame, top bar 64 px tall, desktop type at true UI scale. Use an approximately 1250px centered inner grid, 18px semibold tightly tracked wordmark against a 32px square asset with 8px gap, 14px grey nav and 13px tabular count. Include exactly these navigation labels in this order: Drivers, Market, Changelog, FAQ. Right cluster: stars, quiet 36px ghost Sign in with low-key #5a5048 edge, and one solid 36px coral #ff8f80 rounded-8px button reading Get it for your team with dark lettering.
Quiet direction. Transparent bar on the page ground. One faint full-width #3a342e hairline under it. Desktop links centered. Desktop stars are a single unboxed inline sequence: GitHub Octocat mark, five-point outline star, 8. On mobile the bar stars are an unboxed five-point star and 8.

Hero context: retain the baseline landing hero's restrained warm off-white, heavy tightly tracked Geist heading exactly “Bring your own everything.” left aligned, two lines on phone, and existing copy exactly “You make the decisions.” then “The agents run the factory.” No additional generated copy in the hero. The focus is the bar and upper hero only. Keep a uniform ground and no extra design decoration.
```

## A-desktop · attempt 2

References in tool order

- `inputs/wiz-official-256.png`
- `targets/r1-iterations/A-desktop-v1.png`

```text
Precise screenshot edit. Output exactly one full-bleed high-fidelity flat mockup viewport. Aspect ratio 1440 × 900, exactly 8:5 landscape. No chrome, frames, decoration or visual noise.
Image 1 is the original official transparent painted red Wiz PNG. Image 2 is the draft screenshot to edit. Remove the draft approximation of the logo and insert Image 1 directly as an unchanged transparent raster layer, scaled to 32px on desktop or 30px on phone. Preserve its paint texture, hooked red hat, eye expression, hand, gold star and ornamentation exactly, as if pasting the given PNG in a screenshot. Do not repaint, trace, recolor or generate a new Wiz.
Compress the header to exactly 64px of the 900px image height. Use a 32px logo asset slot, 18px OpenWiz, 14px centered links and 36px buttons. Extend the 1px bottom hairline all the way to both edges.
Use clean Geist-style type, crisp neutral icons, flat untextured #1b1916 ground, #221f1b panel if present, and solid, flat coral #ff8f80 on the one CTA. No copy drift, no bonus words. Do not alter the hero typography and copy. Keep the same direction and state as the draft.
```

## A-desktop · attempt 3 · selected

References in tool order

- `inputs/wiz-official-256.png`
- `targets/r1-iterations/A-desktop-v2.png`

```text
Generate a single compact real-browser-style OpenWiz desktop viewport screenshot. Artboard aspect ratio 8:5, target 1440 × 900. Image 1 is the exact official transparent red and gold painted wizard PNG to place into a tiny 32px square slot as a single immutable asset. Preserve the exact facial details, texture, shape and hat and do not regenerate any logo art. Image 2 indicates the direction of the draft, but its bar is substantially oversized. Redesign the bar at a much smaller apparent scale. The absolute bottom of the entire header is y=64px on this 900px-tall artboard (flush to the top). The bar must look like a tiny sliver of the entire screen, with 14px nav, 18px OpenWiz, and 36px-tall quiet ghost button “Sign in” and solid coral #ff8f80 button “Get it for your team” at the right. The four links read exactly “Drivers”, “Market”, “Changelog”, “FAQ”. No other bar words except those explicitly specified and the stars control. Quiet, faint full-width hairline #3a342e. Center the navigation group. Inline GitHub mark then a five-point outline star and 8, no box. Flat warm charcoal #1b1916 page, no noise or gradients; Geist type; no chrome or framing. Below the header, preserve hero style and text: “Bring your own everything.”, “You make the decisions.”, and “The agents run the factory.”. Pay special attention to dialing down the size of the draft header, controls and logo without making their text illegible.
```

## A-phone · attempt 1

References in tool order

- `inputs/wiz-official-256.png`
- `inputs/baseline/home-phone-screen.png`
- `inputs/refs/phone-sheet.png`

```text
Use case: ui-mockup. Create a sharp screenshot-style design target for the OpenWiz landing-page top bar.
Reference 1 is the exact transparent official painted red Wiz asset. Place this asset unchanged, downscaled with its true colors and silhouette, including the hooked red hat and gold star, two large pale eyes, toothy grin, waving red hand, and red-and-gold robe. Do not draw a new mascot or use the cream silhouette from the baseline. Reference 2 is the OpenWiz baseline and provides the existing warm-dark ground and hero styling. Reference 3 provides UI restraint, spacing, and hierarchy cues only. No reference brand names, imagery, borders, or logos from the sheet belong in the output.
Use flat ground #1b1916 throughout the viewport, Geist and Geist Mono styling, primary text #f3eee8 and secondary text #c8c0b8. Product wordmark exactly OpenWiz. Exactly one viewport, edge to edge, no margins outside the artboard, no reference comparison, no labels identifying direction. All visible words and icons crisp and legible at 1×. No invented copy.
One 390 × 844 tall portrait full-bleed flat browser viewport image, intended to be viewed at its actual 390px width, no device frame, address bar or status bar. Compact single-row bar around 56px tall. Approx 16px side padding, 40px touch areas, 17px semi-bold OpenWiz beside a 30px painted asset, 13px tabular count. On the right: stars, one filled coral #ff8f80 For teams button with dark letters, and the icon-only toggle. Leave enough space that everything is legible.
Quiet direction. Transparent bar on the page ground. One faint full-width #3a342e hairline under it. Desktop links centered. Desktop stars are a single unboxed inline sequence: GitHub Octocat mark, five-point outline star, 8. On mobile the bar stars are an unboxed five-point star and 8.
Menu CLOSED: toggle shows exactly two short horizontal lines. No panel, no visible site links or Sign in.
Hero context: retain the baseline landing hero's restrained warm off-white, heavy tightly tracked Geist heading exactly “Bring your own everything.” left aligned, two lines on phone, and existing copy exactly “You make the decisions.” then “The agents run the factory.” No additional generated copy in the hero. The focus is the bar and upper hero only. Keep a uniform ground and no extra design decoration.
```

## A-phone · attempt 2 · selected

References in tool order

- `inputs/wiz-official-256.png`
- `targets/r1-iterations/A-phone-v1.png`

```text
Precise screenshot edit. Output exactly one full-bleed high-fidelity flat mockup viewport. Aspect ratio 390 × 844, exactly 195:422 tall portrait. Preserve all horizontal UI content and add ground at the bottom as needed to hit this tall aspect ratio. No chrome, frames, decoration or visual noise.
Image 1 is the original official transparent painted red Wiz PNG. Image 2 is the draft screenshot to edit. Remove the draft approximation of the logo and insert Image 1 directly as an unchanged transparent raster layer, scaled to 32px on desktop or 30px on phone. Preserve its paint texture, hooked red hat, eye expression, hand, gold star and ornamentation exactly, as if pasting the given PNG in a screenshot. Do not repaint, trace, recolor or generate a new Wiz.
Erase the version number next to the OpenWiz wordmark, keeping OpenWiz. The only text anywhere in the 56px header is OpenWiz, 8, For teams. Use a neutral outlined five-point star immediately left of 8, and two horizontal strokes at the right. Extend the faint bottom hairline all the way to both edges.
Use clean Geist-style type, crisp neutral icons, flat untextured #1b1916 ground, #221f1b panel if present, and solid, flat coral #ff8f80 on the one CTA. No copy drift, no bonus words. Do not alter the hero typography and copy. Keep the same direction and state as the draft.
```

## A-phone-menu · attempt 1

References in tool order

- `inputs/wiz-official-256.png`
- `inputs/baseline/home-phone-screen.png`
- `inputs/refs/phone-sheet.png`

```text
Use case: ui-mockup. Create a sharp screenshot-style design target for the OpenWiz landing-page top bar.
Reference 1 is the exact transparent official painted red Wiz asset. Place this asset unchanged, downscaled with its true colors and silhouette, including the hooked red hat and gold star, two large pale eyes, toothy grin, waving red hand, and red-and-gold robe. Do not draw a new mascot or use the cream silhouette from the baseline. Reference 2 is the OpenWiz baseline and provides the existing warm-dark ground and hero styling. Reference 3 provides UI restraint, spacing, and hierarchy cues only. No reference brand names, imagery, borders, or logos from the sheet belong in the output.
Use flat ground #1b1916 throughout the viewport, Geist and Geist Mono styling, primary text #f3eee8 and secondary text #c8c0b8. Product wordmark exactly OpenWiz. Exactly one viewport, edge to edge, no margins outside the artboard, no reference comparison, no labels identifying direction. All visible words and icons crisp and legible at 1×. No invented copy.
One 390 × 844 tall portrait full-bleed flat browser viewport image, intended to be viewed at its actual 390px width, no device frame, address bar or status bar. Compact single-row bar around 56px tall. Approx 16px side padding, 40px touch areas, 17px semi-bold OpenWiz beside a 30px painted asset, 13px tabular count. On the right: stars, one filled coral #ff8f80 For teams button with dark letters, and the icon-only toggle. Leave enough space that everything is legible.
Quiet direction. Transparent bar on the page ground. One faint full-width #3a342e hairline under it. Desktop links centered. Desktop stars are a single unboxed inline sequence: GitHub Octocat mark, five-point outline star, 8. On mobile the bar stars are an unboxed five-point star and 8.
Menu OPEN: the icon-only toggle shows an X. A full-height opaque flat dark sheet begins exactly below the bar and fills the rest of the viewport, concealing the hero. Each large single-line left aligned menu row has one label, in this exact order: Drivers, Market, Changelog, FAQ, Sign in. Then one stars row with GitHub Octocat, five-point star, 8. Roomy 56px tap rows and subtle horizontal hairlines. No heading, arrows, or extra labels.
The menu covers all hero content.
```

## A-phone-menu · attempt 2

References in tool order

- `inputs/wiz-official-256.png`
- `targets/r1-iterations/A-phone-menu-v1.png`

```text
Precise screenshot edit. Output exactly one full-bleed high-fidelity flat mockup viewport. Aspect ratio 390 × 844, exactly 195:422 tall portrait. Preserve all horizontal UI content and add ground at the bottom as needed to hit this tall aspect ratio. No chrome, frames, decoration or visual noise.
Image 1 is the original official transparent painted red Wiz PNG. Image 2 is the draft screenshot to edit. Remove the draft approximation of the logo and insert Image 1 directly as an unchanged transparent raster layer, scaled to 32px on desktop or 30px on phone. Preserve its paint texture, hooked red hat, eye expression, hand, gold star and ornamentation exactly, as if pasting the given PNG in a screenshot. Do not repaint, trace, recolor or generate a new Wiz.
Remove all three phantom nav links from the uppermost 56px horizontal header (Drivers, Market and Changelog). The only text in that header is OpenWiz, 8, For teams. The only items in the header are the painted logo, OpenWiz, a neutral five-point outline star with 8, the For teams button and the X icon. Keep the large menu rows below the header exactly as shown, including the stars row and full-height sheet.
Use clean Geist-style type, crisp neutral icons, flat untextured #1b1916 ground, #221f1b panel if present, and solid, flat coral #ff8f80 on the one CTA. No copy drift, no bonus words. Do not alter the hero typography and copy. Keep the same direction and state as the draft.
```

## A-phone-menu · attempt 3 · selected

References in tool order

- `inputs/wiz-official-256.png`
- `targets/r1-iterations/A-phone-v2.png`

```text
Edit one 390 × 844 (195:422 ratio) flat, full-bleed mobile viewport. Image 1 is the exact official transparent red painted Wiz PNG; preserve that unchanged asset as an image layer where the painted logo is shown in Image 2. Image 2 is the existing closed state. Preserve the appearance, size and placement of absolutely every object in its top bar, including the painted logo, wordmark OpenWiz, five-point outlined star and count 8, and the only coral CTA For teams. Replace only the icon of two horizontal lines at far right with an X in the same position. The bar must never acquire any new text. Below the bar show the following menu in its open state. Draw an opaque full-height dark sheet from immediately under the bar to the bottom; cover the hero completely. Six large single-row tap areas, exact copy Drivers, Market, Changelog, FAQ, Sign in, then GitHub icon, neutral outline five-point star, and 8. Muted dividers. No other words or marks. Edge-to-edge dark #1b1916, crisp Geist type at 1×, with no chrome, captions, or outer frame. Do not modify or redraw the official PNG.
```

## B-desktop · attempt 1

References in tool order

- `inputs/wiz-official-256.png`
- `inputs/baseline/home-desktop.png`
- `inputs/refs/desktop-sheet.png`

```text
Use case: ui-mockup. Create a sharp screenshot-style design target for the OpenWiz landing-page top bar.
Reference 1 is the exact transparent official painted red Wiz asset. Place this asset unchanged, downscaled with its true colors and silhouette, including the hooked red hat and gold star, two large pale eyes, toothy grin, waving red hand, and red-and-gold robe. Do not draw a new mascot or use the cream silhouette from the baseline. Reference 2 is the OpenWiz baseline and provides the existing warm-dark ground and hero styling. Reference 3 provides UI restraint, spacing, and hierarchy cues only. No reference brand names, imagery, borders, or logos from the sheet belong in the output.
Use flat ground #1b1916 throughout the viewport, Geist and Geist Mono styling, primary text #f3eee8 and secondary text #c8c0b8. Product wordmark exactly OpenWiz. Exactly one viewport, edge to edge, no margins outside the artboard, no reference comparison, no labels identifying direction. All visible words and icons crisp and legible at 1×. No invented copy.
One 1440 × 900 landscape full-bleed flat browser viewport image, with no frame, top bar 64 px tall, desktop type at true UI scale. Use an approximately 1250px centered inner grid, 18px semibold tightly tracked wordmark against a 32px square asset with 8px gap, 14px grey nav and 13px tabular count. Include exactly these navigation labels in this order: Drivers, Market, Changelog, FAQ. Right cluster: stars, quiet 36px ghost Sign in with low-key #5a5048 edge, and one solid 36px coral #ff8f80 rounded-8px button reading Get it for your team with dark lettering.
Engraved direction. Transparent bar on the page ground. The bottom edge is a single fine muted blue #8fb4ff engraved halftone dither rule fading to nothing at both ends, no glow. Desktop links centered. On this home screen place a small blue dithered current-page underline directly under the OpenWiz wordmark, because the wordmark links to home. Stars are one compact rounded bordered segmented control with precisely this order: GitHub Octocat mark, five-point outline star, label Star, vertical separator, count 8. Keep that pill compact on phone with all of those elements.

Hero context: retain the baseline landing hero's restrained warm off-white, heavy tightly tracked Geist heading exactly “Bring your own everything.” left aligned, two lines on phone, and existing copy exactly “You make the decisions.” then “The agents run the factory.” No additional generated copy in the hero. The focus is the bar and upper hero only. Keep a uniform ground and no extra design decoration.
```

## B-desktop · attempt 2

References in tool order

- `inputs/wiz-official-256.png`
- `targets/r1-iterations/B-desktop-v1.png`

```text
Precise screenshot edit. Output exactly one full-bleed high-fidelity flat mockup viewport. Aspect ratio 1440 × 900, exactly 8:5 landscape. No chrome, frames, decoration or visual noise.
Image 1 is the original official transparent painted red Wiz PNG. Image 2 is the draft screenshot to edit. Remove the draft approximation of the logo and insert Image 1 directly as an unchanged transparent raster layer, scaled to 32px on desktop or 30px on phone. Preserve its paint texture, hooked red hat, eye expression, hand, gold star and ornamentation exactly, as if pasting the given PNG in a screenshot. Do not repaint, trace, recolor or generate a new Wiz.
Compress the header to exactly 64px of the 900px image height. Use a 32px logo asset slot, 18px OpenWiz, 14px centered links and 36px buttons. Keep the blue engraved edge and underline, the pill's icon sequence and the copy.
Use clean Geist-style type, crisp neutral icons, flat untextured #1b1916 ground, #221f1b panel if present, and solid, flat coral #ff8f80 on the one CTA. No copy drift, no bonus words. Do not alter the hero typography and copy. Keep the same direction and state as the draft.
```

## B-desktop · attempt 3 · selected

References in tool order

- `inputs/wiz-official-256.png`
- `targets/r1-iterations/B-desktop-v1.png`

```text
Generate a single compact real-browser-style OpenWiz desktop viewport screenshot. Artboard aspect ratio 8:5, target 1440 × 900. Image 1 is the exact official transparent red and gold painted wizard PNG to place into a tiny 32px square slot as a single immutable asset. Preserve the exact facial details, texture, shape and hat and do not regenerate any logo art. Image 2 indicates the direction of the draft, but its bar is substantially oversized. Redesign the bar at a much smaller apparent scale. The absolute bottom of the entire header is y=64px on this 900px-tall artboard (flush to the top). The bar must look like a tiny sliver of the entire screen, with 14px nav, 18px OpenWiz, and 36px-tall quiet ghost button “Sign in” and solid coral #ff8f80 button “Get it for your team” at the right. The four links read exactly “Drivers”, “Market”, “Changelog”, “FAQ”. No other bar words except those explicitly specified and the stars control. Engraved, muted #8fb4ff fine dithered bottom rule, fading at both ends, and a small matching underline beneath OpenWiz to indicate Home. Center the navigation group. Bordered star control exactly [GitHub mark, five-point outline star, Star | 8]. Flat warm charcoal #1b1916 page, no noise or gradients; Geist type; no chrome or framing. Below the header, preserve hero style and text: “Bring your own everything.”, “You make the decisions.”, and “The agents run the factory.”. Pay special attention to dialing down the size of the draft header, controls and logo without making their text illegible.
```

## B-phone · attempt 1

References in tool order

- `inputs/wiz-official-256.png`
- `inputs/baseline/home-phone-screen.png`
- `inputs/refs/phone-sheet.png`

```text
Use case: ui-mockup. Create a sharp screenshot-style design target for the OpenWiz landing-page top bar.
Reference 1 is the exact transparent official painted red Wiz asset. Place this asset unchanged, downscaled with its true colors and silhouette, including the hooked red hat and gold star, two large pale eyes, toothy grin, waving red hand, and red-and-gold robe. Do not draw a new mascot or use the cream silhouette from the baseline. Reference 2 is the OpenWiz baseline and provides the existing warm-dark ground and hero styling. Reference 3 provides UI restraint, spacing, and hierarchy cues only. No reference brand names, imagery, borders, or logos from the sheet belong in the output.
Use flat ground #1b1916 throughout the viewport, Geist and Geist Mono styling, primary text #f3eee8 and secondary text #c8c0b8. Product wordmark exactly OpenWiz. Exactly one viewport, edge to edge, no margins outside the artboard, no reference comparison, no labels identifying direction. All visible words and icons crisp and legible at 1×. No invented copy.
One 390 × 844 tall portrait full-bleed flat browser viewport image, intended to be viewed at its actual 390px width, no device frame, address bar or status bar. Compact single-row bar around 56px tall. Approx 16px side padding, 40px touch areas, 17px semi-bold OpenWiz beside a 30px painted asset, 13px tabular count. On the right: stars, one filled coral #ff8f80 For teams button with dark letters, and the icon-only toggle. Leave enough space that everything is legible.
Engraved direction. Transparent bar on the page ground. The bottom edge is a single fine muted blue #8fb4ff engraved halftone dither rule fading to nothing at both ends, no glow. Desktop links centered. On this home screen place a small blue dithered current-page underline directly under the OpenWiz wordmark, because the wordmark links to home. Stars are one compact rounded bordered segmented control with precisely this order: GitHub Octocat mark, five-point outline star, label Star, vertical separator, count 8. Keep that pill compact on phone with all of those elements.
Menu CLOSED: toggle shows exactly two short horizontal lines. No panel, no visible site links or Sign in.
Hero context: retain the baseline landing hero's restrained warm off-white, heavy tightly tracked Geist heading exactly “Bring your own everything.” left aligned, two lines on phone, and existing copy exactly “You make the decisions.” then “The agents run the factory.” No additional generated copy in the hero. The focus is the bar and upper hero only. Keep a uniform ground and no extra design decoration.
```

## B-phone · attempt 2 · selected

References in tool order

- `inputs/wiz-official-256.png`
- `targets/r1-iterations/B-phone-v1.png`

```text
Precise screenshot edit. Output exactly one full-bleed high-fidelity flat mockup viewport. Aspect ratio 390 × 844, exactly 195:422 tall portrait. Preserve all horizontal UI content and add ground at the bottom as needed to hit this tall aspect ratio. No chrome, frames, decoration or visual noise.
Image 1 is the original official transparent painted red Wiz PNG. Image 2 is the draft screenshot to edit. Remove the draft approximation of the logo and insert Image 1 directly as an unchanged transparent raster layer, scaled to 32px on desktop or 30px on phone. Preserve its paint texture, hooked red hat, eye expression, hand, gold star and ornamentation exactly, as if pasting the given PNG in a screenshot. Do not repaint, trace, recolor or generate a new Wiz.
Keep all the existing copy and the fine blue engraved rule and underline. Fit a 56px header in the 390px wide view, with a 30px logo slot. Retain every segment of the star pill.
Use clean Geist-style type, crisp neutral icons, flat untextured #1b1916 ground, #221f1b panel if present, and solid, flat coral #ff8f80 on the one CTA. No copy drift, no bonus words. Do not alter the hero typography and copy. Keep the same direction and state as the draft.
```

## B-phone-menu · attempt 1

References in tool order

- `inputs/wiz-official-256.png`
- `inputs/baseline/home-phone-screen.png`
- `inputs/refs/phone-sheet.png`

```text
Use case: ui-mockup. Create a sharp screenshot-style design target for the OpenWiz landing-page top bar.
Reference 1 is the exact transparent official painted red Wiz asset. Place this asset unchanged, downscaled with its true colors and silhouette, including the hooked red hat and gold star, two large pale eyes, toothy grin, waving red hand, and red-and-gold robe. Do not draw a new mascot or use the cream silhouette from the baseline. Reference 2 is the OpenWiz baseline and provides the existing warm-dark ground and hero styling. Reference 3 provides UI restraint, spacing, and hierarchy cues only. No reference brand names, imagery, borders, or logos from the sheet belong in the output.
Use flat ground #1b1916 throughout the viewport, Geist and Geist Mono styling, primary text #f3eee8 and secondary text #c8c0b8. Product wordmark exactly OpenWiz. Exactly one viewport, edge to edge, no margins outside the artboard, no reference comparison, no labels identifying direction. All visible words and icons crisp and legible at 1×. No invented copy.
One 390 × 844 tall portrait full-bleed flat browser viewport image, intended to be viewed at its actual 390px width, no device frame, address bar or status bar. Compact single-row bar around 56px tall. Approx 16px side padding, 40px touch areas, 17px semi-bold OpenWiz beside a 30px painted asset, 13px tabular count. On the right: stars, one filled coral #ff8f80 For teams button with dark letters, and the icon-only toggle. Leave enough space that everything is legible.
Engraved direction. Transparent bar on the page ground. The bottom edge is a single fine muted blue #8fb4ff engraved halftone dither rule fading to nothing at both ends, no glow. Desktop links centered. On this home screen place a small blue dithered current-page underline directly under the OpenWiz wordmark, because the wordmark links to home. Stars are one compact rounded bordered segmented control with precisely this order: GitHub Octocat mark, five-point outline star, label Star, vertical separator, count 8. Keep that pill compact on phone with all of those elements.
Menu OPEN: the icon-only toggle shows an X. The compact dark #221f1b panel drops directly under the blue engraved bar edge, overhead of the landing hero, with a matching thin muted-blue engraved finishing edge. Each large single-line left aligned menu row has one label, in this exact order: Drivers, Market, Changelog, FAQ, Sign in. Roomy approximately 50px rows. Stars remain available in the bar only. The existing hero sits behind the overlay. No heading, arrows or extra menu labels.
Hero context: retain the baseline landing hero's restrained warm off-white, heavy tightly tracked Geist heading exactly “Bring your own everything.” left aligned, two lines on phone, and existing copy exactly “You make the decisions.” then “The agents run the factory.” No additional generated copy in the hero. The focus is the bar and upper hero only. Keep a uniform ground and no extra design decoration.
```

## B-phone-menu · attempt 2

References in tool order

- `inputs/wiz-official-256.png`
- `targets/r1-iterations/B-phone-menu-v1.png`

```text
Precise screenshot edit. Output exactly one full-bleed high-fidelity flat mockup viewport. Aspect ratio 390 × 844, exactly 195:422 tall portrait. Preserve all horizontal UI content and add ground at the bottom as needed to hit this tall aspect ratio. No chrome, frames, decoration or visual noise.
Image 1 is the original official transparent painted red Wiz PNG. Image 2 is the draft screenshot to edit. Remove the draft approximation of the logo and insert Image 1 directly as an unchanged transparent raster layer, scaled to 32px on desktop or 30px on phone. Preserve its paint texture, hooked red hat, eye expression, hand, gold star and ornamentation exactly, as if pasting the given PNG in a screenshot. Do not repaint, trace, recolor or generate a new Wiz.
Keep all the existing copy and the fine blue engraved rules and underline. Fit a 56px header and five approximately 48px menu rows in the 390px wide view. Retain every segment of the star pill. Keep the menu overlaid and show muted landing page context below it.
Use clean Geist-style type, crisp neutral icons, flat untextured #1b1916 ground, #221f1b panel if present, and solid, flat coral #ff8f80 on the one CTA. No copy drift, no bonus words. Do not alter the hero typography and copy. Keep the same direction and state as the draft.
```

## B-phone-menu · attempt 3 · selected

References in tool order

- `inputs/wiz-official-256.png`
- `targets/r1-iterations/B-phone-v2.png`
- `targets/r1-iterations/B-phone-menu-v2.png`

```text
Create one true 390 × 844 portrait flat full-bleed OpenWiz mobile screenshot (195:422 ratio). Reference 1 is the exact transparent official painted red Wiz raster asset. Use the official raster itself unchanged at 30px, preserving its exact painted features and colors. Reference 2 is the closed screenshot that controls all top-bar placement. Reference 3 illustrates the contents of the open menu only. Reproduce the same top bar from reference 2 at the same y-position and size, with the single exception that the rightmost two-line toggle becomes an X. Keep exactly the painted logo, OpenWiz wordmark and small blue underlining, contiguous segmented pill with GitHub symbol then outline five-point star then Star and a vertical separator and 8, and coral button exactly For teams. Keep the fading blue engraved header rule. Show an open #221f1b drop panel attached directly below this bar, above the page and with a matching subtle blue dither rule at its bottom. Exactly five large left-aligned rows, in order: Drivers, Market, Changelog, FAQ, Sign in. No heading, extra icons, or new words. The panel overlays the starting page at its original position so it covers the original upper hero; do not shift the headline down. Under the panel show the warm #1b1916 ground, with no invented content. Crisp Geist styling and flat color. No browser or device frames.
```

## C-desktop · attempt 1

References in tool order

- `inputs/wiz-official-256.png`
- `inputs/baseline/home-desktop.png`
- `inputs/refs/desktop-sheet.png`

```text
Use case: ui-mockup. Create a sharp screenshot-style design target for the OpenWiz landing-page top bar.
Reference 1 is the exact transparent official painted red Wiz asset. Place this asset unchanged, downscaled with its true colors and silhouette, including the hooked red hat and gold star, two large pale eyes, toothy grin, waving red hand, and red-and-gold robe. Do not draw a new mascot or use the cream silhouette from the baseline. Reference 2 is the OpenWiz baseline and provides the existing warm-dark ground and hero styling. Reference 3 provides UI restraint, spacing, and hierarchy cues only. No reference brand names, imagery, borders, or logos from the sheet belong in the output.
Use flat ground #1b1916 throughout the viewport, Geist and Geist Mono styling, primary text #f3eee8 and secondary text #c8c0b8. Product wordmark exactly OpenWiz. Exactly one viewport, edge to edge, no margins outside the artboard, no reference comparison, no labels identifying direction. All visible words and icons crisp and legible at 1×. No invented copy.
One 1440 × 900 landscape full-bleed flat browser viewport image, with no frame, top bar 64 px tall, desktop type at true UI scale. Use an approximately 1250px centered inner grid, 18px semibold tightly tracked wordmark against a 32px square asset with 8px gap, 14px grey nav and 13px tabular count. Include exactly these navigation labels in this order: Drivers, Market, Changelog, FAQ. Right cluster: stars, quiet 36px ghost Sign in with low-key #5a5048 edge, and one solid 36px coral #ff8f80 rounded-8px button reading Get it for your team with dark lettering.
Capsule direction. Entire bar sits inside a floating rounded rectangle #221f1b, with 1px #3a342e stroke, 14px radius and a small gap from top and both sides. No full-width separator. Desktop navigation links sit left immediately after the logo and wordmark. Desktop stars are an unboxed GitHub Octocat mark, five-point outline star and 8. Phone capsule stars are an unboxed five-point star and 8.

Hero context: retain the baseline landing hero's restrained warm off-white, heavy tightly tracked Geist heading exactly “Bring your own everything.” left aligned, two lines on phone, and existing copy exactly “You make the decisions.” then “The agents run the factory.” No additional generated copy in the hero. The focus is the bar and upper hero only. Keep a uniform ground and no extra design decoration.
```

## C-desktop · attempt 2

References in tool order

- `inputs/wiz-official-256.png`
- `targets/r1-iterations/C-desktop-v1.png`

```text
Edit this single flat screenshot mockup. Image 1 is the original official transparent painted red Wiz PNG. Image 2 is the capsule draft screenshot to edit. Replace the draft approximation of the official logo with Image 1 itself, directly composited using its original alpha, proportion and colors as if pasting the PNG. Do not retouch, redraw, filter or stylize the painting. Output 1440 × 900 (8:5 landscape). Trim the large outer padding above the capsule to 12px and use a compact 64px bar with 32px logo, 18px wordmark and 14px navigation. Preserve all text, button order and grouping exactly as seen in the example. Keep the headline “Bring your own everything.” and existing two subhead lines. Use clean Geist-style type, flat #1b1916 ground, #221f1b capsule and panel, 1px #3a342e strokes, 14px radii and solid #ff8f80 fill on the one CTA. One flat viewport without a device, browser chrome, visual noise or caption.
```

## C-desktop · attempt 3 · selected

References in tool order

- `inputs/wiz-official-256.png`
- `targets/r1-iterations/C-desktop-v2.png`

```text
Generate a single compact real-browser-style OpenWiz desktop viewport screenshot. Artboard aspect ratio 8:5, target 1440 × 900. Image 1 is the exact official transparent red and gold painted wizard PNG to place into a tiny 32px square slot as a single immutable asset. Preserve the exact facial details, texture, shape and hat and do not regenerate any logo art. Image 2 indicates the direction of the draft, but its bar is substantially oversized. Redesign the bar at a much smaller apparent scale. The absolute bottom of the entire header is y=64px on this 900px-tall artboard (76px including the top gap). The bar must look like a tiny sliver of the entire screen, with 14px nav, 18px OpenWiz, and 36px-tall quiet ghost button “Sign in” and solid coral #ff8f80 button “Get it for your team” at the right. The four links read exactly “Drivers”, “Market”, “Changelog”, “FAQ”. No other bar words except those explicitly specified and the stars control. Capsule, a #221f1b panel with 1px #3a342e edge and 14px corners, 12px top gap and 20px side gaps. Navigation is left aligned after exact painted logo and OpenWiz. Inline GitHub mark, outline five-point star, 8. Flat warm charcoal #1b1916 page, no noise or gradients; Geist type; no chrome or framing. Below the header, preserve hero style and text: “Bring your own everything.”, “You make the decisions.”, and “The agents run the factory.”. Pay special attention to dialing down the size of the draft header, controls and logo without making their text illegible.
```

## C-phone · attempt 1

References in tool order

- `inputs/wiz-official-256.png`
- `inputs/baseline/home-phone-screen.png`
- `inputs/refs/phone-sheet.png`

```text
Use case: ui-mockup. Create a sharp screenshot-style design target for the OpenWiz landing-page top bar.
Reference 1 is the exact transparent official painted red Wiz asset. Place this asset unchanged, downscaled with its true colors and silhouette, including the hooked red hat and gold star, two large pale eyes, toothy grin, waving red hand, and red-and-gold robe. Do not draw a new mascot or use the cream silhouette from the baseline. Reference 2 is the OpenWiz baseline and provides the existing warm-dark ground and hero styling. Reference 3 provides UI restraint, spacing, and hierarchy cues only. No reference brand names, imagery, borders, or logos from the sheet belong in the output.
Use flat ground #1b1916 throughout the viewport, Geist and Geist Mono styling, primary text #f3eee8 and secondary text #c8c0b8. Product wordmark exactly OpenWiz. Exactly one viewport, edge to edge, no margins outside the artboard, no reference comparison, no labels identifying direction. All visible words and icons crisp and legible at 1×. No invented copy.
One 390 × 844 tall portrait full-bleed flat browser viewport image, intended to be viewed at its actual 390px width, no device frame, address bar or status bar. Compact single-row bar around 56px tall. Approx 16px side padding, 40px touch areas, 17px semi-bold OpenWiz beside a 30px painted asset, 13px tabular count. On the right: stars, one filled coral #ff8f80 For teams button with dark letters, and the icon-only toggle. Leave enough space that everything is legible.
Capsule direction. Entire bar sits inside a floating rounded rectangle #221f1b, with 1px #3a342e stroke, 14px radius and a small gap from top and both sides. No full-width separator. Desktop navigation links sit left immediately after the logo and wordmark. Desktop stars are an unboxed GitHub Octocat mark, five-point outline star and 8. Phone capsule stars are an unboxed five-point star and 8.
Menu CLOSED: toggle shows exactly two short horizontal lines. No panel, no visible site links or Sign in.
Hero context: retain the baseline landing hero's restrained warm off-white, heavy tightly tracked Geist heading exactly “Bring your own everything.” left aligned, two lines on phone, and existing copy exactly “You make the decisions.” then “The agents run the factory.” No additional generated copy in the hero. The focus is the bar and upper hero only. Keep a uniform ground and no extra design decoration.
```

## C-phone · attempt 2 · selected

References in tool order

- `inputs/wiz-official-256.png`
- `targets/r1-iterations/C-phone-v1.png`

```text
Precise screenshot edit. Output exactly one full-bleed high-fidelity flat mockup viewport. Aspect ratio 390 × 844, exactly 195:422 tall portrait. Preserve all horizontal UI content and add ground at the bottom as needed to hit this tall aspect ratio. No chrome, frames, decoration or visual noise.
Image 1 is the original official transparent painted red Wiz PNG. Image 2 is the draft screenshot to edit. Remove the draft approximation of the logo and insert Image 1 directly as an unchanged transparent raster layer, scaled to 32px on desktop or 30px on phone. Preserve its paint texture, hooked red hat, eye expression, hand, gold star and ornamentation exactly, as if pasting the given PNG in a screenshot. Do not repaint, trace, recolor or generate a new Wiz.
Erase the version number next to the OpenWiz wordmark, keeping OpenWiz. Replace the cluster immediately left of the coral button with ONE neutral outlined five-point star followed by the visible number 8. Remove the GitHub mark. Set the rightmost hamburger to exactly TWO horizontal strokes. The only text in the capsule is OpenWiz, 8, For teams. Preserve the floating capsule, spacing and hero.
Use clean Geist-style type, crisp neutral icons, flat untextured #1b1916 ground, #221f1b panel if present, and solid, flat coral #ff8f80 on the one CTA. No copy drift, no bonus words. Do not alter the hero typography and copy. Keep the same direction and state as the draft.
```

## C-phone-menu · attempt 1

References in tool order

- `inputs/wiz-official-256.png`
- `inputs/baseline/home-phone-screen.png`
- `inputs/refs/phone-sheet.png`

```text
Use case: ui-mockup. Create a sharp screenshot-style design target for the OpenWiz landing-page top bar.
Reference 1 is the exact transparent official painted red Wiz asset. Place this asset unchanged, downscaled with its true colors and silhouette, including the hooked red hat and gold star, two large pale eyes, toothy grin, waving red hand, and red-and-gold robe. Do not draw a new mascot or use the cream silhouette from the baseline. Reference 2 is the OpenWiz baseline and provides the existing warm-dark ground and hero styling. Reference 3 provides UI restraint, spacing, and hierarchy cues only. No reference brand names, imagery, borders, or logos from the sheet belong in the output.
Use flat ground #1b1916 throughout the viewport, Geist and Geist Mono styling, primary text #f3eee8 and secondary text #c8c0b8. Product wordmark exactly OpenWiz. Exactly one viewport, edge to edge, no margins outside the artboard, no reference comparison, no labels identifying direction. All visible words and icons crisp and legible at 1×. No invented copy.
One 390 × 844 tall portrait full-bleed flat browser viewport image, intended to be viewed at its actual 390px width, no device frame, address bar or status bar. Compact single-row bar around 56px tall. Approx 16px side padding, 40px touch areas, 17px semi-bold OpenWiz beside a 30px painted asset, 13px tabular count. On the right: stars, one filled coral #ff8f80 For teams button with dark letters, and the icon-only toggle. Leave enough space that everything is legible.
Capsule direction. Entire bar sits inside a floating rounded rectangle #221f1b, with 1px #3a342e stroke, 14px radius and a small gap from top and both sides. No full-width separator. Desktop navigation links sit left immediately after the logo and wordmark. Desktop stars are an unboxed GitHub Octocat mark, five-point outline star and 8. Phone capsule stars are an unboxed five-point star and 8.
Menu OPEN: the icon-only toggle shows an X. A separate compact #221f1b panel with matching 14px rounded corners and 1px #3a342e border opens with an 8px gap below the capsule, overlaying the landing hero. Each large single-line left aligned menu row has one label, in this exact order: Drivers, Market, Changelog, FAQ, Sign in. Roomy approximately 50px rows. Stars remain available in the bar only. No heading, arrows or extra menu labels.
Hero context: retain the baseline landing hero's restrained warm off-white, heavy tightly tracked Geist heading exactly “Bring your own everything.” left aligned, two lines on phone, and existing copy exactly “You make the decisions.” then “The agents run the factory.” No additional generated copy in the hero. The focus is the bar and upper hero only. Keep a uniform ground and no extra design decoration.
```

## C-phone-menu · attempt 2

References in tool order

- `inputs/wiz-official-256.png`
- `targets/r1-iterations/C-phone-menu-v1.png`

```text
Edit this single flat screenshot mockup. Image 1 is the original official transparent painted red Wiz PNG. Image 2 is the capsule draft screenshot to edit. Replace the draft approximation of the official logo with Image 1 itself, directly composited using its original alpha, proportion and colors as if pasting the PNG. Do not retouch, redraw, filter or stylize the painting. Output 390 × 844 (195:422 tall portrait). Floating 56px phone capsule. Keep the OpenWiz wordmark. Remove all links and version text from the capsule itself. Immediately left of the For teams button put only a neutral five-point outline star and the number 8, without a GitHub mark. The only text in the capsule is OpenWiz, 8, For teams. Keep the X at the right and the separate rounded panel below the capsule, with exactly five rows: Drivers, Market, Changelog, FAQ, Sign in. Keep the headline “Bring your own everything.” and existing two subhead lines. Use clean Geist-style type, flat #1b1916 ground, #221f1b capsule and panel, 1px #3a342e strokes, 14px radii and solid #ff8f80 fill on the one CTA. One flat viewport without a device, browser chrome, visual noise or caption.
```

## C-phone-menu · attempt 3 · selected

References in tool order

- `inputs/wiz-official-256.png`
- `targets/r1-iterations/C-phone-v2.png`

```text
Edit one 390 × 844 (195:422 ratio) flat, full-bleed mobile viewport. Image 1 is the exact official transparent red painted Wiz PNG; preserve that unchanged asset as an image layer where the painted logo is shown in Image 2. Image 2 is the existing closed state. Preserve the appearance, size and placement of absolutely every object in its top bar, including the painted logo, wordmark OpenWiz, five-point outlined star and count 8, and the only coral CTA For teams. Replace only the icon of two horizontal lines at far right with an X in the same position. The bar must never acquire any new text. Below the bar show the following menu in its open state. Draw a dark #221f1b discrete floating panel just below the bar with the same thin border and 14px radius. Exact copy Drivers, Market, Changelog, FAQ, Sign in. Left align, five roomy rows; no adornments. Keep hero in the original location behind this overlay so the panel covers the portion of the hero behind it; do not push the hero down. Add no other words. Edge-to-edge dark #1b1916, crisp Geist type at 1×, with no chrome, captions, or outer frame. Do not modify or redraw the official PNG.
```
