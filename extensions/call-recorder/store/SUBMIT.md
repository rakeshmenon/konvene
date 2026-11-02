# Putting Call Recorder on the Chrome Web Store

Everything that can be prepared is prepared. The steps below need you, because they involve your account, your name and your decisions.

## Before you submit

1. **Fill the blanks.** Search `store/` for square brackets:
   - `[Publisher name]` and `[contact email]` in `store/privacy-policy.md`
   - `[your support page ...]`, `[where you publish ...]` in `store/listing.md`
   Then run `npm run store:assets` to rebuild `store/privacy-policy.html`.
2. **Publish the privacy policy** (`store/privacy-policy.html`) at a public address. The dashboard needs a URL. A page on your own site, GitHub Pages or any static host works.
3. **Check the brand.** The extension uses Konvene's logo, colours and fonts, and says "Konvene" in its text. Make sure the owners of Konvene are happy for you to publish under that look.
4. **Licence:** AGPL-3.0, the same as Konvene (see the `LICENSE` file in the Konvene repository).
5. **Deploy the Konvene change** (the badge, in `src/main.js`). The extension refuses to record on Konvene until the live page confirms its badge.
6. **Try it yourself first** on a real call (see "Not verified yet" in the README), on the machine and Chrome you care about.

## Submit

1. Create a developer account at the Chrome Web Store developer dashboard. There is a one-time registration fee.
2. Run `npm run package`. Upload `store/package/call-recorder-<version>.zip`.
3. **Store listing:** copy the text from `store/listing.md`. Upload `store/screenshots/*.png` and `store/promo/small-tile-440x280.png`. The screenshots are the real pages with sample data.
4. **Privacy practices:** paste the single purpose and each permission justification from `store/permissions.md`. Fill in the data usage table the same way. Add the privacy policy URL.
5. **Test instructions:** paste the "Notes for the reviewer" section of `store/permissions.md`.
6. **Distribution:** choose public, unlisted or private, and the regions.
7. Submit for review.

## What to expect

- `tabCapture` and a microphone make this a sensitive extension, so review can take longer than for a simple one. Reviewers will read the permission justifications, so keep them accurate.
- Each update needs a higher `version` in `package.json`. Run `npm run package` again.
- If a reviewer asks for a change, `npm run check` and `npm run smoke` tell you the extension still works before you resubmit.
