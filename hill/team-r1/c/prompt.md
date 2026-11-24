# Booking card targets

The built-in image generation tool used the full-page browser screenshots at the parent commit as references. The selected PNGs were resized proportionally to their requested export widths.

## Phone prompt

```text
Edit the supplied full-page OpenWiz /team/ screenshot. Produce a single full-height, pixel-faithful website design target, edge to edge, with navbar and footer fully visible, no device frame or external annotations. Use the reference image as the edit target. Preserve its typography, warm charcoal dark background, exact original headline and lead, original painted ship film and control position on the film, steps, facts, footer, text and layout. The only layout change is to replace the first isolated button and note with a compact quiet card and to wrap the closing button and new reminder in a matching shallow card. Use a thin neutral gray border with softly rounded corners and barely lighter warm charcoal fill, existing coral-brass accent on the two Book a call buttons only, off-white text, subdued gray mono labels. Neutralize the step numbers and Drivers underline without changing content. The hero card places the Book a call button at top left, followed by two compact label-value groups separated by a fine horizontal line. Label “Call” beside these four exact lines: “30 minutes”, “With Jake, who built OpenWiz”, “On your own repository”, “You leave with a reviewed pull request; merging stays your call”. Label “Bring” beside these two exact lines: “a repository with working CI”, “a signed-in Claude Code or Codex”. The closing card has the same Book a call button and the exact reminder “30 minutes with Jake on your own repository.” No emoji, extra illustrations, badges, marketing copy, prices, or gradients. Keep the original film art.

Phone viewport 390 CSS pixels wide with a 390 × 844 first screen. Preserve the single-column layout. Use tight 12px card padding and a full-width button at the top. First button must be fully visible within 844px. The closing card is full width beneath the existing closing headline, with button above the reminder. Include the entire tall page, prioritizing fidelity to the screenshot’s proportions.
```

## Phone refinement prompt

```text
Refine this generated full-page mobile OpenWiz website mockup. Remove the wide blank dark gutters on both sides so the mobile page itself fills the image edge to edge, with narrow page insets of about 18 CSS px on a 390 CSS px layout. Preserve the entire vertical page including navigation and the large OpenWiz footer wordmark. Keep the current two booking-card designs, all of their exact text, the original site headline, ship film, sections and dark palette. Smooth out the blotchy overlay so surfaces are flat warm charcoal and text stays crisp. Use the tallest portrait aspect ratio available. Do not compress, rearrange or omit any section.
```

The first output added wide side gutters. The refinement fills the frame, keeps both cards and the whole page visible, and puts the first booking button above the film. The generated film crop, text rendering, and section spacing differ from the reference. The page implementation uses the existing film, typography, and section styles.

## Desktop prompt

```text
Edit the supplied full-page OpenWiz /team/ screenshot. Produce a single full-height, pixel-faithful website design target, edge to edge, with navbar and footer fully visible, no device frame or external annotations. Use the reference image as the edit target. Preserve its typography, warm charcoal dark background, exact original headline and lead, original painted ship film and control position on the film, steps, facts, footer, text and layout. The only layout change is to replace the first isolated button and note with a compact quiet card and to wrap the closing button and new reminder in a matching shallow card. Use a thin neutral gray border with softly rounded corners and barely lighter warm charcoal fill, existing coral-brass accent on the two Book a call buttons only, off-white text, subdued gray mono labels. Neutralize the step numbers and Drivers underline without changing content. The hero card places the Book a call button at top left, followed by two compact label-value groups separated by a fine horizontal line. Label “Call” beside these four exact lines: “30 minutes”, “With Jake, who built OpenWiz”, “On your own repository”, “You leave with a reviewed pull request; merging stays your call”. Label “Bring” beside these two exact lines: “a repository with working CI”, “a signed-in Claude Code or Codex”. The closing card has the same Book a call button and the exact reminder “30 minutes with Jake on your own repository.” No emoji, extra illustrations, badges, marketing copy, prices, or gradients. Keep the original film art.

Desktop viewport 1440 CSS pixels wide. Preserve the left hero copy and right film composition. Keep the hero card aligned with the lead, with an intrinsic-width button at the top. Place the shallow closing card to the right of the closing headline, with button and reminder side by side. Include the entire page, prioritizing fidelity to the screenshot’s proportions.
```

The desktop output retains the two-column hero, puts the button first in the hero card, and shows the shallow closing card next to the existing headline. The film and footer contain small rendering differences. The page implementation uses the original assets and copy.
