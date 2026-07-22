import { useCallback } from 'react';
import { useTelescopeStore } from '../store/useTelescopeStore';

/**
 * ── Localization Engine (Phase 28) ──────────────────────────────
 * A lightweight, dependency-free dictionary + lookup, covering
 * TelemetryPanel, LiveViewPanel, the footer controls, and InfoTip's
 * TIP_COPY — the surfaces named for Phase 28's string extraction pass.
 * Astronomical catalog DATA (target names, eyepiece labels, telescope
 * profile names in src/data/bookContent.ts / engine/constants.ts) is left
 * in English by design — this covers UI chrome, not content.
 *
 * Usage: const { t } = useTranslation(); t('telemetry.target')
 * Interpolation: t('telemetry.configuredCount', { n: 2 }) replaces `{n}`.
 */

export type Language = 'en' | 'hi';

export type TranslationKey = keyof typeof en;

const en = {
  // ── common.* — shared across surfaces ──
  'common.target': 'Target',
  'common.manualSlew': 'Manual Slew',
  'common.on': 'ON',
  'common.off': 'OFF',
  'common.altitude': 'altitude',
  'common.belowHorizon': 'Below Horizon',
  'common.alt': 'ALT',
  'common.az': 'AZ',

  // ── telemetry.* — TelemetryPanel.tsx ──
  'telemetry.heading': 'Telemetry',
  'telemetry.telescope': 'Telescope',
  'telemetry.magnification': 'Magnification',
  'telemetry.trueFov': 'True FOV',
  'telemetry.exitPupil': 'Exit Pupil',
  'telemetry.brightness': 'Brightness',
  'telemetry.environment': 'Environment',
  'telemetry.location': 'Location:',
  'telemetry.minusHour': '−1 Hour',
  'telemetry.plusHour': '+1 Hour',
  'telemetry.now': 'Now',
  'telemetry.pause': 'Pause',
  'telemetry.play': 'Play',
  'telemetry.motor': 'Motor:',
  'telemetry.onTarget': 'On Target',
  'telemetry.yesWithId': 'YES ({id})',
  'telemetry.noNeedId': 'NO — need {id}',
  'telemetry.focusDelta': 'Focus Δ',
  'telemetry.units': 'units',
  'telemetry.capstoneTargets': 'Capstone Targets',
  'telemetry.configuredCount': '{n}/3 configured',
  'telemetry.missionComplete': '✓ Mission Complete',
  'telemetry.virtualNight': 'Virtual Night',

  // ── tip.* — InfoTip.tsx TIP_COPY ──
  'tip.magnification':
    'How many times bigger the telescope makes things look. Telescope focal length ÷ eyepiece focal length. More is not always better!',
  'tip.trueFov':
    'The slice of real sky you can see through the eyepiece, in degrees. Higher magnification = a smaller window onto the sky.',
  'tip.exitPupil':
    'The width of the light beam leaving the eyepiece and entering your eye. Bigger = brighter view; wider than your pupil (~7mm) wastes light.',
  'tip.brightness':
    'How bright the view looks compared to the maximum your eye can use. Driven by the exit pupil — high magnification makes images dimmer.',
  'tip.seeing':
    'How calm the atmosphere is tonight, rated 1 (perfect) to 5 (boiling). Bad seeing smears fine detail, especially at high power.',
  'tip.siderealMotor':
    'A slow motor that turns the telescope at exactly the speed Earth spins, so celestial targets stay still in the eyepiece instead of drifting out.',
  'tip.timeRate':
    'Simulation playback speed. At 60×, one real second is a simulated minute — watch the sky visibly rotate!',
  'tip.environment':
    'Where and when you are observing. The simulated clock drives the whole sky: every star position comes from this time and place.',
  'tip.finderError':
    'How far the small finderscope aims away from where the main telescope actually points, in degrees. Zero this out with the screws.',
  'tip.alignmentLock':
    'Real observers center a bright target in the MAIN eyepiece first, and only then adjust the finder screws to match. The screws stay locked until you do.',
  'tip.barlow':
    'A Barlow lens doubles your magnification with the same eyepiece — but it also doubles the blur from atmosphere and focus errors.',
  'tip.dustCap':
    'The lens cap on the front of the tube. The #1 reason beginners see nothing at all!',
  'tip.solarFilter':
    'A safety filter that blocks 99.999% of sunlight. REQUIRED for the Sun — it blacks out everything else.',
  'tip.belowHorizon':
    'This object is currently underneath the ground from your location. Advance the simulation time until Earth rotates it into view.',
  'tip.digitalZoom':
    'A Fun-mode camera trick: doubles the image size with software, no physics involved. Real telescopes cannot do this without penalty!',
  'tip.simulationMode':
    'Global difficulty: Fun (perfect tracking, zoom freely), Easy (forgiving physics), Realistic (true field conditions).',
  'tip.focuser':
    'Turns to move the eyepiece until the image is sharp. Each eyepiece has its own sweet spot — watch for the green marker.',
  'tip.virtualNight':
    'Forces a night-dark sky no matter where the Sun really is, so you can explore the stars in the daytime. Purely visual — the simulation clock keeps running normally.',
  'tip.slewPad':
    'Manual slew controls: hold to nudge the mount in altitude and azimuth. The main eyepiece and finderscope shift together — both are bolted to the same tube!',
  'tip.pausePlay': 'Freeze the simulation clock in place, or resume normal playback.',
  'tip.recenterTarget': "Click to snap the mount's pointing back onto the target's exact current position.",

  // ── tour.* — OnboardingTour.tsx (Phase 30) ──
  'tour.startTour': 'Start Tour',
  'tour.stepOf': 'Step {step} of {total}',
  'tour.skip': 'Skip',
  'tour.next': 'Next',
  'tour.finish': 'Finish',
  'tour.welcome.title': 'Welcome to BRAHMAND',
  'tour.welcome.body':
    "This simulator is designed to teach you how to operate a physical telescope, understand its optics, and navigate the night sky. Let's learn the controls.",
  'tour.simMode.title': 'Simulation Modes',
  'tour.simMode.body':
    "This sets the global difficulty. Fun keeps things simple — tracking stays locked and you're free to zoom in. Realistic behaves like a real, drifting telescope, where targets slip out of view and you must track them by hand. Easy sits in between.",
  'tour.language.title': 'Language Option',
  'tour.language.body':
    'Switch between English and Hindi at any time using this toggle — every label in the app updates instantly.',
  'tour.dustcap.title': 'Remove the Dust Cap',
  'tour.dustcap.body':
    "Every telescope ships with a protective cap over the front opening. Click here to take it off first — with the cap on, no light can enter and the view stays completely black. It's the #1 reason beginners think their telescope is broken!",
  'tour.target.title': 'Choose Your Target',
  'tour.target.body':
    'Pick what to observe here — the Moon, Saturn, the Orion Nebula, and more. Selecting one automatically slews the telescope toward it.',
  'tour.time.title': 'The Simulation Clock',
  'tour.time.body':
    "This is the simulated date and time — it drives the entire sky. If a target reads 'Below Horizon', it's simply on the other side of the Earth right now. Tap +1 Hour to advance time until it rises.",
  'tour.motor.title': 'Sidereal Tracking Motor',
  'tour.motor.body':
    "Earth's rotation constantly drifts targets out of view. Turn the Motor ON to have the mount automatically follow the sky, like a real tracking mount.",
  'tour.finderscope.title': 'The Finderscope',
  'tour.finderscope.body':
    'This small circle is the Finderscope: a low-power, wide-angle "gun sight" bolted to the main tube. Its wide field makes it easy to spot a target and roughly aim the telescope at it.',
  'tour.mainEyepiece.title': 'The Main Eyepiece',
  'tour.mainEyepiece.body':
    "This large circle is the Main Eyepiece — the telescope's real, high-power view. Once the Finderscope has you roughly on target, this is where you'll see the actual detail: craters, rings, and clouds of dust and gas.",
  'tour.eyepiece.title': 'Eyepiece Selector',
  'tour.eyepiece.body':
    'Swap eyepieces here to change magnification. A 32mm eyepiece shows a wide view; a 4mm eyepiece zooms in close but shows less sky at once.',
  'tour.focuser.title': 'The Focuser Knob',
  'tour.focuser.body':
    'Turn this knob to slide the eyepiece in and out until the image snaps into focus. Watch for the green marker — it shows exactly where perfect focus lies for your current eyepiece.',
  // First-visit prompt toast (Phase 33)
  'tour.promptTitle': 'New to the simulator?',
  'tour.promptBody': 'Take the 2-minute guided tour and learn the controls.',

  // ── liveview.* — LiveViewPanel.tsx (visible DOM text; canvas-drawn HUD
  // text — reticle labels, astro HUD readouts — is out of scope for this
  // pass, see Phase 28 summary) ──
  'liveview.mainEyepiece': 'Main Eyepiece',
  'liveview.finderscope': 'Finderscope',
  'liveview.finderErrorLabel': 'Finder Error',
  'liveview.targetCentered': 'Target centered — screws unlocked',
  'liveview.centerToUnlock': 'Center a target in the main eyepiece to unlock the screws',
  'liveview.difficultyAuto': 'Auto',
  'liveview.difficultyEasy': 'Easy',
  'liveview.difficultyMedium': 'Medium',
  'liveview.difficultyRealistic': 'Realistic',
  'liveview.scramble': 'Scramble',
  'liveview.trackIntro': "Earth's rotation drifts the target out of view. Drag the main eyepiece to re-centre it.",
  'liveview.trackInvertedNote': 'A reflecting telescope inverts everything 180° — dragging feels backwards. Train your muscle memory!',
  'liveview.trackNaturalNote': 'This telescope shows a natural, non-inverted view, so dragging feels intuitive.',
  'liveview.trackHoldInstruction': 'Keep the target centred for 15 seconds to complete this lesson.',
  'liveview.slew': 'Slew',
  'liveview.planetary': 'Planetary',
  'liveview.deepSky': 'Deep Sky',
  'liveview.bahtinov': 'Bahtinov',
  'liveview.frameExposure': 'Frame Exposure',
  'liveview.stackCutoff': 'Stack Cutoff (Top %)',
  'liveview.topPct': 'Top {pct}%',
  'liveview.captured': '✓ Captured',
  'liveview.recording': 'Recording…',
  'liveview.recordN': 'Record {n}',
  'liveview.stackAndGrade': 'Stack & Grade',
  'liveview.subExposure': 'Sub-Exposure',
  'liveview.subExposuresN': 'Sub-Exposures (N)',
  'liveview.isoGain': 'ISO / Gain',
  'liveview.trackingLocked': 'Tracking: LOCKED',
  'liveview.trackingOff': 'Tracking: OFF',
  'liveview.darksN': 'Darks ({n})',
  'liveview.darks': 'Darks',
  'liveview.applyCalibration': 'Apply Calibration',
  'liveview.stackSubsAndGrade': 'Stack {n} Subs & Grade',
  'liveview.planetaryFooterHint': 'Record high-speed video and select the sharpest frames to beat atmospheric seeing.',
  'liveview.dsoFooterHint': 'Stack sub-exposures to pull faint detail out of the noise. Take Dark Frames to remove hot pixels!',

  // ── footer.* — App.tsx <footer> controls ──
  'footer.logbookBadges': 'Field Logbook & Badges',
  'footer.moduleFinderscope': 'Finderscope Alignment',
  'footer.moduleDobsonian': 'Inverted View Tracker',
  'footer.moduleAstrophotography': 'Astrophotography',
  'footer.focuserKnob': 'Focuser Knob',
  'footer.perfectFocus': 'PERFECT FOCUS',
  'footer.outOfFocus': 'OUT OF FOCUS',
  'footer.astroHint': 'Planetary: Lucky Imaging • Deep Sky: Stacking + Calibration',
  'footer.dustCap': 'Dust Cap',
  'footer.solarFilter': 'Solar Filter',
  'footer.noneManual': 'None — Manual',
  'footer.eyepiece': 'Eyepiece',
  'footer.seeingAntoniadi': 'Seeing (Antoniadi)',
  'footer.barlow2x': '2x Barlow',
  'footer.digitalZoom': 'Digital Zoom',
  'footer.addCustomTelescope': 'Add Custom Telescope',
  'footer.add': 'Add',

  // ── textbook.* — TextbookPanel.tsx (Phase 31) ──
  'textbook.heading': 'Textbook',
  'textbook.completedCount': '{n}/{total} lessons completed',
  'textbook.tryItOut': 'Try it out',
  'textbook.completed': 'Completed',
} as const;

const hi: Record<TranslationKey, string> = {
  // ── common.* ──
  'common.target': 'लक्ष्य',
  'common.manualSlew': 'मैनुअल स्लीव',
  'common.on': 'चालू',
  'common.off': 'बंद',
  'common.altitude': 'ऊँचाई',
  'common.belowHorizon': 'क्षितिज से नीचे',
  'common.alt': 'ऊँचाई',
  'common.az': 'दिगंश',

  // ── telemetry.* ──
  'telemetry.heading': 'टेलीमेट्री',
  'telemetry.telescope': 'टेलीस्कोप',
  'telemetry.magnification': 'आवर्धन',
  'telemetry.trueFov': 'वास्तविक FOV',
  'telemetry.exitPupil': 'निकास पुतली',
  'telemetry.brightness': 'चमक',
  'telemetry.environment': 'वातावरण',
  'telemetry.location': 'स्थान:',
  'telemetry.minusHour': '−1 घंटा',
  'telemetry.plusHour': '+1 घंटा',
  'telemetry.now': 'अभी',
  'telemetry.pause': 'पॉज़',
  'telemetry.play': 'प्ले',
  'telemetry.motor': 'मोटर:',
  'telemetry.onTarget': 'लक्ष्य पर',
  'telemetry.yesWithId': 'हाँ ({id})',
  'telemetry.noNeedId': 'नहीं — {id} चाहिए',
  'telemetry.focusDelta': 'फ़ोकस Δ',
  'telemetry.units': 'इकाई',
  'telemetry.capstoneTargets': 'कैपस्टोन लक्ष्य',
  'telemetry.configuredCount': '{n}/3 कॉन्फ़िगर किए गए',
  'telemetry.missionComplete': '✓ मिशन पूर्ण',
  'telemetry.virtualNight': 'वर्चुअल रात',

  // ── tip.* ──
  'tip.magnification':
    'टेलीस्कोप चीज़ों को कितनी गुना बड़ा दिखाता है। टेलीस्कोप की फोकल लंबाई ÷ आईपीस की फोकल लंबाई। ज़्यादा हमेशा बेहतर नहीं होता!',
  'tip.trueFov':
    'आईपीस से दिखने वाले असली आकाश का हिस्सा, डिग्री में। आवर्धन जितना ज़्यादा होगा, आकाश की खिड़की उतनी ही छोटी होगी।',
  'tip.exitPupil':
    'आईपीस से निकलकर आपकी आँख में जाने वाली प्रकाश किरण की चौड़ाई। बड़ी निकास पुतली = चमकीला दृश्य; आपकी पुतली (~7mm) से बड़ी होने पर प्रकाश व्यर्थ जाता है।',
  'tip.brightness':
    'आपकी आँख जितना उपयोग कर सकती है, उसकी तुलना में दृश्य कितना चमकीला दिखता है। यह निकास पुतली पर निर्भर करता है — अधिक आवर्धन से छवि धुंधली हो जाती है।',
  'tip.seeing':
    'आज रात वायुमंडल कितना शांत है, 1 (उत्तम) से 5 (अशांत) तक। खराब सीइंग बारीक विवरण को धुंधला कर देती है, खासकर उच्च आवर्धन पर।',
  'tip.siderealMotor':
    'एक धीमी नाक्षत्रिक मोटर जो टेलीस्कोप को ठीक पृथ्वी के घूर्णन की गति से घुमाती है, ताकि आकाशीय लक्ष्य आईपीस में स्थिर रहें, खिसककर बाहर न निकलें।',
  'tip.timeRate':
    'सिमुलेशन की प्लेबैक गति। 60× पर, एक वास्तविक सेकंड सिमुलेशन में एक मिनट के बराबर होता है — आकाश को घूमते हुए देखें!',
  'tip.environment':
    'आप कहाँ और कब अवलोकन कर रहे हैं। सिम्युलेटेड घड़ी पूरे आकाश को नियंत्रित करती है: हर तारे की स्थिति इसी समय और स्थान से तय होती है।',
  'tip.finderError':
    'छोटा फाइंडरस्कोप मुख्य टेलीस्कोप की वास्तविक दिशा से कितनी डिग्री दूर लक्ष्य कर रहा है। पेंचों (स्क्रू) से इसे शून्य करें।',
  'tip.alignmentLock':
    'असली खगोलप्रेक्षक पहले किसी चमकीले लक्ष्य को मुख्य आईपीस के केंद्र में लाते हैं, तभी फाइंडर के पेंच समायोजित करते हैं। जब तक आप ऐसा नहीं करते, पेंच लॉक रहते हैं।',
  'tip.barlow':
    'बार्लो लेंस उसी आईपीस से आपका आवर्धन दोगुना कर देता है — लेकिन इससे वायुमंडल और फोकस की त्रुटियों से होने वाला धुंधलापन भी दोगुना हो जाता है।',
  'tip.dustCap':
    'ट्यूब के आगे लगा लेंस कैप। शुरुआती लोगों को कुछ भी न दिखने का सबसे बड़ा कारण!',
  'tip.solarFilter':
    'एक सुरक्षा फ़िल्टर जो 99.999% सूर्य के प्रकाश को रोकता है। सूर्य के लिए ज़रूरी है — बाकी हर चीज़ को यह पूरी तरह काला कर देता है।',
  'tip.belowHorizon':
    'यह वस्तु फ़िलहाल आपके स्थान से क्षितिज के नीचे है। सिमुलेशन समय आगे बढ़ाएँ जब तक पृथ्वी घूमकर इसे दृश्य में न ले आए।',
  'tip.digitalZoom':
    "'फन मोड' की एक कैमरा तरकीब: सॉफ़्टवेयर से छवि का आकार दोगुना कर देती है, इसमें कोई भौतिकी शामिल नहीं। असली टेलीस्कोप बिना नुकसान के ऐसा नहीं कर सकते!",
  'tip.simulationMode':
    'सम्पूर्ण कठिनाई स्तर: फन (सटीक ट्रैकिंग, मुक्त ज़ूम), ईज़ी (सरल भौतिकी), रियलिस्टिक (वास्तविक क्षेत्र स्थितियाँ)।',
  'tip.focuser':
    'इसे घुमाने से आईपीस तब तक हिलती है जब तक छवि स्पष्ट न हो जाए। हर आईपीस का अपना सही बिंदु होता है — हरे निशान पर ध्यान दें।',
  'tip.virtualNight':
    'सूर्य वास्तव में कहीं भी हो, आकाश को रात जैसा गहरा कर देता है — ताकि आप दिन में भी तारों को देख सकें। यह केवल दृश्य प्रभाव है — सिमुलेशन घड़ी सामान्य रूप से चलती रहती है।',
  'tip.slewPad':
    'मैनुअल स्लीव नियंत्रण: माउंट को ऊँचाई और दिगंश में घुमाने के लिए दबाए रखें। मुख्य आईपीस और फाइंडरस्कोप साथ-साथ खिसकते हैं — दोनों एक ही ट्यूब पर कसे हैं!',
  'tip.pausePlay': 'सिमुलेशन घड़ी को वहीं रोक दें, या सामान्य प्लेबैक फिर से शुरू करें।',
  'tip.recenterTarget': 'माउंट की दिशा को लक्ष्य की ठीक वर्तमान स्थिति पर वापस लाने के लिए क्लिक करें।',

  // ── tour.* ──
  'tour.startTour': 'टूर शुरू करें',
  'tour.stepOf': 'चरण {step} / {total}',
  'tour.skip': 'छोड़ें',
  'tour.next': 'अगला',
  'tour.finish': 'समाप्त करें',
  'tour.welcome.title': 'BRAHMAND में आपका स्वागत है',
  'tour.welcome.body':
    'यह सिम्युलेटर आपको एक वास्तविक टेलीस्कोप चलाना, उसकी प्रकाशिकी को समझना, और रात के आकाश में राह खोजना सिखाने के लिए बनाया गया है। आइए नियंत्रण सीखें।',
  'tour.simMode.title': 'सिमुलेशन मोड',
  'tour.simMode.body':
    "यह समग्र कठिनाई स्तर तय करता है। 'फन' मोड में चीज़ें सरल रहती हैं — ट्रैकिंग लॉक रहती है और आप बेझिझक ज़ूम कर सकते हैं। 'रियलिस्टिक' मोड एक असली, बहकते हुए टेलीस्कोप जैसा व्यवहार करता है, जहाँ लक्ष्य दृश्य से खिसक जाते हैं और आपको उन्हें हाथ से ट्रैक करना पड़ता है। 'ईज़ी' इन दोनों के बीच का विकल्प है।",
  'tour.language.title': 'भाषा विकल्प',
  'tour.language.body':
    'इस टॉगल से आप कभी भी अंग्रेज़ी और हिंदी के बीच स्विच कर सकते हैं — ऐप के सभी लेबल तुरंत बदल जाते हैं।',
  'tour.dustcap.title': 'डस्ट कैप हटाएँ',
  'tour.dustcap.body':
    'हर टेलीस्कोप के आगे के हिस्से पर एक सुरक्षा कैप लगी होती है। सबसे पहले इसे यहाँ से हटाएँ — कैप लगी रहने पर कोई भी रोशनी अंदर नहीं जा सकती और दृश्य पूरी तरह काला रहता है। शुरुआती लोगों को कुछ न दिखने का यही सबसे बड़ा कारण है!',
  'tour.target.title': 'अपना लक्ष्य चुनें',
  'tour.target.body':
    'यहाँ से तय करें कि क्या देखना है — चंद्रमा, शनि, ओरायन नेबुला, और भी बहुत कुछ। लक्ष्य चुनते ही टेलीस्कोप अपने आप उसकी ओर मुड़ जाता है।',
  'tour.time.title': 'सिमुलेशन घड़ी',
  'tour.time.body':
    "यह सिम्युलेटेड तारीख़ और समय है — यही पूरे आकाश को नियंत्रित करता है। अगर कोई लक्ष्य 'क्षितिज से नीचे' दिखे, तो वह फ़िलहाल पृथ्वी के दूसरी ओर है। +1 घंटा दबाकर समय आगे बढ़ाएँ जब तक वह ऊपर न आ जाए।",
  'tour.motor.title': 'नाक्षत्रिक ट्रैकिंग मोटर',
  'tour.motor.body':
    'पृथ्वी का घूर्णन लक्ष्य को लगातार दृश्य से बाहर खिसकाता रहता है। मोटर को चालू करें ताकि माउंट असली ट्रैकिंग माउंट की तरह अपने आप आकाश का पीछा करे।',
  'tour.finderscope.title': 'फाइंडरस्कोप',
  'tour.finderscope.body':
    'यह छोटा वृत्त फाइंडरस्कोप है: मुख्य ट्यूब पर लगा कम-आवर्धन, चौड़े कोण का "गन-साइट"। इसका चौड़ा क्षेत्र किसी लक्ष्य को ढूँढना और टेलीस्कोप को मोटे तौर पर उस पर लक्षित करना आसान बना देता है।',
  'tour.mainEyepiece.title': 'मुख्य आईपीस',
  'tour.mainEyepiece.body':
    'यह बड़ा वृत्त मुख्य आईपीस है — टेलीस्कोप का असली, उच्च-आवर्धन वाला दृश्य। एक बार फाइंडरस्कोप से मोटा निशाना लग जाए, तो यहीं असली विवरण दिखता है: गड्ढे, वलय, और धूल-गैस के बादल।',
  'tour.eyepiece.title': 'आईपीस चयनकर्ता',
  'tour.eyepiece.body':
    'आवर्धन बदलने के लिए यहाँ आईपीस बदलें। 32mm आईपीस चौड़ा दृश्य दिखाता है; 4mm आईपीस पास से ज़ूम करता है पर एक साथ कम आकाश दिखाता है।',
  'tour.focuser.title': 'फ़ोकसर नॉब',
  'tour.focuser.body':
    'छवि को स्पष्ट होने तक आईपीस को अंदर-बाहर खिसकाने के लिए इस नॉब को घुमाएँ। हरे निशान पर ध्यान दें — यह आपके मौजूदा आईपीस के लिए सटीक फ़ोकस बिंदु दिखाता है।',
  // First-visit prompt toast (Phase 33)
  'tour.promptTitle': 'सिम्युलेटर में नए हैं?',
  'tour.promptBody': '2 मिनट का गाइडेड टूर लें और नियंत्रण सीखें।',

  // ── liveview.* ──
  'liveview.mainEyepiece': 'मुख्य आईपीस',
  'liveview.finderscope': 'फाइंडरस्कोप',
  'liveview.finderErrorLabel': 'फाइंडर त्रुटि',
  'liveview.targetCentered': 'लक्ष्य केंद्रित — पेंच अनलॉक',
  'liveview.centerToUnlock': 'पेंच अनलॉक करने के लिए मुख्य आईपीस में लक्ष्य को केंद्रित करें',
  'liveview.difficultyAuto': 'स्वतः',
  'liveview.difficultyEasy': 'आसान',
  'liveview.difficultyMedium': 'मध्यम',
  'liveview.difficultyRealistic': 'यथार्थवादी',
  'liveview.scramble': 'अस्त-व्यस्त करें',
  'liveview.trackIntro': 'पृथ्वी के घूर्णन से लक्ष्य दृश्य से खिसक जाता है। उसे फिर से केंद्र में लाने के लिए मुख्य आईपीस को खींचें।',
  'liveview.trackInvertedNote': 'परावर्तक टेलीस्कोप (रिफ्लेक्टर) हर चीज़ को 180° उल्टा दिखाता है — खींचना उल्टा महसूस होगा। अपनी मांसपेशी-याददाश्त प्रशिक्षित करें!',
  'liveview.trackNaturalNote': 'यह टेलीस्कोप एक प्राकृतिक, सीधा दृश्य दिखाता है, इसलिए खींचना सहज महसूस होगा।',
  'liveview.trackHoldInstruction': 'इस पाठ को पूरा करने के लिए लक्ष्य को 15 सेकंड तक केंद्र में रखें।',
  'liveview.slew': 'स्लीव',
  'liveview.planetary': 'ग्रहीय',
  'liveview.deepSky': 'गहरा आकाश',
  'liveview.bahtinov': 'बाहटिनोव',
  'liveview.frameExposure': 'फ्रेम एक्सपोज़र',
  'liveview.stackCutoff': 'स्टैक कटऑफ़ (शीर्ष %)',
  'liveview.topPct': 'शीर्ष {pct}%',
  'liveview.captured': '✓ कैप्चर हो गया',
  'liveview.recording': 'रिकॉर्डिंग…',
  'liveview.recordN': '{n} रिकॉर्ड करें',
  'liveview.stackAndGrade': 'स्टैक करें और ग्रेड दें',
  'liveview.subExposure': 'सब-एक्सपोज़र',
  'liveview.subExposuresN': 'सब-एक्सपोज़र (N)',
  'liveview.isoGain': 'ISO / गेन',
  'liveview.trackingLocked': 'ट्रैकिंग: लॉक',
  'liveview.trackingOff': 'ट्रैकिंग: बंद',
  'liveview.darksN': 'डार्क्स ({n})',
  'liveview.darks': 'डार्क्स',
  'liveview.applyCalibration': 'कैलिब्रेशन लागू करें',
  'liveview.stackSubsAndGrade': '{n} सब स्टैक करें और ग्रेड दें',
  'liveview.planetaryFooterHint': 'तेज़ गति वाला वीडियो रिकॉर्ड करें और वायुमंडलीय अशांति को मात देने के लिए सबसे तीक्ष्ण फ्रेम चुनें।',
  'liveview.dsoFooterHint': 'शोर से महीन विवरण निकालने के लिए सब-एक्सपोज़र स्टैक करें। हॉट पिक्सेल हटाने के लिए डार्क फ्रेम लें!',

  // ── footer.* ──
  'footer.logbookBadges': 'फ़ील्ड लॉगबुक और बैज',
  'footer.moduleFinderscope': 'फाइंडरस्कोप एलाइनमेंट',
  'footer.moduleDobsonian': 'इनवर्टेड व्यू ट्रैकर',
  'footer.moduleAstrophotography': 'एस्ट्रोफ़ोटोग्राफ़ी',
  'footer.focuserKnob': 'फ़ोकसर नॉब',
  'footer.perfectFocus': 'सटीक फ़ोकस',
  'footer.outOfFocus': 'फ़ोकस से बाहर',
  'footer.astroHint': 'ग्रहीय: लकी इमेजिंग • गहरा आकाश: स्टैकिंग + कैलिब्रेशन',
  'footer.dustCap': 'डस्ट कैप',
  'footer.solarFilter': 'सोलर फ़िल्टर',
  'footer.noneManual': 'कोई नहीं — मैन्युअल',
  'footer.eyepiece': 'आईपीस',
  'footer.seeingAntoniadi': 'सीइंग (एंटोनियाडी)',
  'footer.barlow2x': '2x बार्लो',
  'footer.digitalZoom': 'डिजिटल ज़ूम',
  'footer.addCustomTelescope': 'कस्टम टेलीस्कोप जोड़ें',
  'footer.add': 'जोड़ें',

  // ── textbook.* ──
  'textbook.heading': 'पाठ्यपुस्तक',
  'textbook.completedCount': '{n}/{total} पाठ पूर्ण',
  'textbook.tryItOut': 'आज़माकर देखें',
  'textbook.completed': 'पूर्ण',
};

export const TRANSLATIONS: Record<Language, Record<TranslationKey, string>> = { en, hi };

/** Pure lookup — usable outside React (e.g. non-component helpers). */
export function translate(language: Language, key: TranslationKey, vars?: Record<string, string | number>): string {
  const dict = TRANSLATIONS[language] ?? TRANSLATIONS.en;
  let str = dict[key] ?? TRANSLATIONS.en[key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      str = str.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value));
    }
  }
  return str;
}

/**
 * Reads the active language from useTelescopeStore and returns a `t(key)`
 * lookup function. Components re-render automatically when the language
 * changes, since this subscribes to the store like any other selector.
 */
export function useTranslation() {
  const language = useTelescopeStore((s) => s.language);
  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>) => translate(language, key, vars),
    [language]
  );
  return { t, language };
}
