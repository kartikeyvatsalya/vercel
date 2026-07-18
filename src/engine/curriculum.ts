import type { ModuleId } from '../types';
import type { Language } from './i18n';
import { useProgressStore } from '../store/useProgressStore';

/**
 * ── Curriculum Engine (Phase 31) ────────────────────────────────
 * Textbook lesson content, bilingual (en/hi) like engine/i18n.ts, but kept
 * as its own record rather than flattened into i18n.ts's TranslationKey
 * dictionary — that file is scoped to short UI-chrome strings, while a
 * lesson is a handful of long paragraphs. Body strings support a minimal
 * **bold** markdown (rendered by TextbookPanel.tsx's own tiny parser —
 * no markdown dependency, consistent with the rest of the app).
 *
 * Each lesson optionally names the practical hook its "Try it out" button
 * triggers — a Rank Curriculum mission (missionId, from data/missions.ts)
 * and/or a 2D module + target to jump to (moduleId/targetId). Completion
 * is derived from whichever real gameplay signal already fires for that
 * hook (a mission's achievement, or a module's completedModules entry) —
 * see evaluateLessonCompletion, called from App.tsx alongside the other
 * evaluate* progress checks.
 */

export type LessonId = 'magnification_fov' | 'mounts_field_rotation' | 'solar_system_saturn' | 'jovian_system';

export interface LessonContent {
  title: string;
  body: string[];
}

export interface Lesson {
  id: LessonId;
  content: Record<Language, LessonContent>;
  /** 2D module the "Try it out" button switches to, if any. */
  moduleId?: ModuleId;
  /** Target the "Try it out" button slews to, if any (ignored when missionId also sets one). */
  targetId?: string;
  /** Rank Curriculum mission (data/missions.ts id) the "Try it out" button starts. Its achievement id doubles as this lesson's completion signal. */
  missionId?: string;
  /** Fallback completion signal for lessons with no missionId — checked against completedModules. */
  completionModuleId?: string;
  /** Completion signal for lessons whose practical is a free-form exercise rather than a mission or module — checked against earned achievements (Phase 32). */
  achievementId?: string;
}

export const CURRICULUM: Lesson[] = [
  {
    id: 'magnification_fov',
    missionId: 'rank1_runaway_moon',
    content: {
      en: {
        title: 'Magnification & Focal Length',
        body: [
          "Every telescope has a **focal length** — the distance light travels inside the tube before it comes into focus, measured in millimeters. Every eyepiece has one too, usually printed right on its barrel (25mm, 10mm, 4mm...). Divide one by the other and you get **magnification**: telescope focal length ÷ eyepiece focal length. A 1200mm telescope with a 25mm eyepiece gives 48×. Swap in a 4mm eyepiece and the same telescope jumps to 300×.",
          "But magnification is only half the story. Every eyepiece also has an **apparent field of view** — how wide a cone of sky it shows you, usually around 50° for a simple eyepiece. Divide that by your magnification and you get the number that actually matters for finding things: **True Field of View (True FOV)** — how many degrees of REAL sky fit inside the view.",
          "This is why higher magnification always shows LESS sky. Push the power up to see more Saturn detail, and your true field shrinks to a pinhole — miss the aim by half a degree and the planet is gone. Drop back to a wide eyepiece and the sky floods back in, forgiving small aiming errors and giving Earth's rotation more room to work with before a target drifts out of view.",
          "A good rule of thumb: start wide to find and frame a target, then increase magnification only as far as the image (and the atmosphere) can honestly support.",
        ],
      },
      hi: {
        title: 'आवर्धन और फोकल लंबाई',
        body: [
          "हर टेलीस्कोप की एक **फोकल लंबाई** होती है — वह दूरी जो प्रकाश ट्यूब के अंदर फ़ोकस में आने से पहले तय करता है, मिलीमीटर में मापी जाती है। हर आईपीस की भी अपनी फोकल लंबाई होती है, जो आमतौर पर उसके बैरल पर ही छपी होती है (25mm, 10mm, 4mm...)। एक को दूसरे से भाग दें तो **आवर्धन** मिलता है: टेलीस्कोप की फोकल लंबाई ÷ आईपीस की फोकल लंबाई। 1200mm टेलीस्कोप पर 25mm आईपीस लगाने से 48× आवर्धन मिलता है। उसी टेलीस्कोप पर 4mm आईपीस लगाएँ तो आवर्धन बढ़कर 300× हो जाता है।",
          "लेकिन आवर्धन पूरी कहानी नहीं है। हर आईपीस का एक **आभासी क्षेत्र दृश्य (apparent field of view)** भी होता है — यह बताता है कि वह आकाश का कितना चौड़ा शंकु दिखाता है, आमतौर पर एक सामान्य आईपीस के लिए लगभग 50°। इसे अपने आवर्धन से भाग दें तो वह संख्या मिलती है जो वस्तु ढूँढ़ने के लिए असल में मायने रखती है: **वास्तविक FOV (True Field of View)** — यानी दृश्य के भीतर असली आकाश की कितनी डिग्री समाई हुई है।",
          "यही कारण है कि ज़्यादा आवर्धन हमेशा कम आकाश दिखाता है। शनि का ज़्यादा विवरण देखने के लिए पावर बढ़ाएँ, तो आपका वास्तविक क्षेत्र सिकुड़कर सुई की नोक जैसा हो जाता है — निशाना आधा डिग्री भी चूका तो ग्रह दृश्य से गायब। किसी चौड़े आईपीस पर वापस जाएँ तो आकाश फिर से भर जाता है, छोटी निशाना-चूक माफ़ हो जाती है, और पृथ्वी के घूर्णन को लक्ष्य को दृश्य से बाहर खिसकाने में ज़्यादा समय लगता है।",
          "एक अच्छा नियम: लक्ष्य को ढूँढ़ने और फ्रेम करने के लिए चौड़े आईपीस से शुरू करें, फिर आवर्धन को तभी बढ़ाएँ जब तक छवि (और वायुमंडल) ईमानदारी से उसे सहारा दे सके।",
        ],
      },
    },
  },
  {
    id: 'mounts_field_rotation',
    moduleId: 'dobsonian',
    targetId: 'saturn',
    completionModuleId: 'dobsonian_trainer',
    content: {
      en: {
        title: 'Mounts & Field Rotation',
        body: [
          "A telescope's **mount** is the machine that lets it point and track — and there are two fundamentally different philosophies. An **Alt-Azimuth (Alt-Az) mount** — like this simulator's Dobsonian — moves in the same two directions you would: up-down (altitude) and left-right (azimuth). It's simple, cheap, and intuitive to build and use.",
          "An **Equatorial mount** is tilted so one of its axes points at the celestial pole, parallel to Earth's own axis. Turn that ONE axis at the sidereal rate — the same speed Earth spins — and the mount cancels the sky's motion perfectly, with no second axis needed to track.",
          "Here is the catch: an Alt-Az mount has to constantly adjust BOTH axes at different, changing speeds to track a target, and it has no way to cancel out one subtle effect — **field rotation** (also called the **parallactic angle**). As a celestial object crosses the sky, its apparent 'up' direction slowly rotates in the eyepiece, even while the mount keeps the object centered. An Equatorial mount's single tilted axis avoids this entirely — the view holds a fixed orientation all night.",
          "For visual observing, field rotation barely matters — your eye doesn't notice a slow spin. But for astrophotography, where exposures stack over minutes, it can smear stars into arcs unless the mount compensates for it. This is one reason serious deep-sky imagers prefer Equatorial mounts, while Alt-Az Dobsonians remain unbeatable for affordable, big-aperture visual observing.",
        ],
      },
      hi: {
        title: 'माउंट के प्रकार और फील्ड रोटेशन',
        body: [
          "टेलीस्कोप का **माउंट** वह तंत्र है जो उसे आकाश की ओर इंगित करने और ट्रैक करने देता है — और इसके पीछे दो बुनियादी तरह के दृष्टिकोण हैं। **अल्ट-एज़िमुथ (ऊँचाई-दिगंश) माउंट** — जैसे इस सिम्युलेटर का डॉब्सोनियन — ठीक उन्हीं दो दिशाओं में घूमता है जिनमें आप खुद घुमाते: ऊपर-नीचे (ऊँचाई) और दाएँ-बाएँ (दिगंश)। यह बनाने और इस्तेमाल करने में सरल, सस्ता और सहज है।",
          "**भूमध्यरेखीय (Equatorial) माउंट** इस तरह झुका होता है कि उसकी एक धुरी सीधे आकाशीय ध्रुव की ओर इशारा करती है, ठीक पृथ्वी की अपनी धुरी के समानांतर। उसी एक धुरी को **नाक्षत्रिक दर** पर घुमाएँ — ठीक उसी गति से जिससे पृथ्वी घूमती है — तो माउंट आकाश की गति को पूरी तरह रद्द कर देता है, ट्रैक करने के लिए दूसरी धुरी की ज़रूरत ही नहीं पड़ती।",
          "यहीं पेच है: अल्ट-एज़िमुथ माउंट को किसी लक्ष्य को ट्रैक करने के लिए लगातार दोनों धुरियों को अलग-अलग, बदलती गति से समायोजित करना पड़ता है, और वह एक सूक्ष्म प्रभाव को रद्द नहीं कर पाता — **फील्ड रोटेशन** (जिसे **पैरालैक्टिक कोण** भी कहते हैं)। जैसे-जैसे कोई आकाशीय वस्तु आकाश को पार करती है, आईपीस में उसकी दिखने वाली 'ऊपर' की दिशा धीरे-धीरे घूमती रहती है, भले ही माउंट वस्तु को केंद्र में बनाए रखे। भूमध्यरेखीय माउंट की एक झुकी हुई धुरी इस समस्या से पूरी तरह बच जाती है — पूरी रात दृश्य की दिशा स्थिर बनी रहती है।",
          "दृश्य अवलोकन (visual observing) के लिए फील्ड रोटेशन का लगभग कोई असर नहीं पड़ता — आपकी आँख धीमे घूर्णन को नोटिस ही नहीं करती। लेकिन एस्ट्रोफ़ोटोग्राफ़ी में, जहाँ कई मिनटों तक एक्सपोज़र जमा होते हैं, यह तारों को चाप (arcs) में फैला सकता है जब तक माउंट इसकी भरपाई न करे। यही एक कारण है कि गंभीर डीप-स्काई इमेजर भूमध्यरेखीय माउंट पसंद करते हैं, जबकि किफ़ायती, बड़े-अपर्चर दृश्य अवलोकन के लिए अल्ट-एज़िमुथ डॉब्सोनियन आज भी बेजोड़ है।",
        ],
      },
    },
  },
  {
    id: 'solar_system_saturn',
    missionId: 'rank1_wandering_star',
    content: {
      en: {
        title: 'The Solar System: Tracking Saturn',
        body: [
          "Almost everything in the night sky — every star in Orion, every star in the Big Dipper — holds the same position relative to its neighbors for a human lifetime. Ancient astronomers noticed a handful of lights that didn't: they wandered slowly against the fixed stars, always staying close to one path across the sky called the **ecliptic**. The Greeks called them 'planetes' — wanderers. We call them planets.",
          "Saturn is the most rewarding of the wanderers to observe. Even a modest telescope resolves its signature **rings** — actually billions of icy particles, spread thinner than paper across a disk wider than the planet itself. Saturn's rings tilt toward and away from Earth over its ~29.5-year orbit, so the view slowly changes across a human lifetime, from wide-open rings to a knife-edge line and back.",
          "Because Saturn is so far away, its position among the stars barely shifts night to night — unlike the Moon, which visibly moves in its own right within hours. What DOES change every night is where Saturn appears to rise and set, driven entirely by Earth's own rotation. This simulator computes that motion the same way real observatories do: from Saturn's catalog position (Right Ascension and Declination) plus your location and the current time.",
          "To resolve Saturn's rings clearly, you need enough magnification to overcome the planet's tiny apparent size — but not so much that the atmosphere turns the image into a shimmering blur. Finding that sweet spot, night by night, is the whole craft of planetary observing.",
        ],
      },
      hi: {
        title: 'सौरमंडल: शनि की ट्रैकिंग',
        body: [
          "रात के आकाश में लगभग हर चीज़ — ओरायन का हर तारा, सप्तर्षि (Big Dipper) का हर तारा — पूरे मानव जीवनकाल तक अपने पड़ोसियों के सापेक्ष एक ही स्थिति में बनी रहती है। प्राचीन खगोलविदों ने कुछ ऐसी रोशनियाँ देखीं जो ऐसा नहीं करती थीं: वे स्थिर तारों के सापेक्ष धीरे-धीरे भटकती थीं, हमेशा आकाश के एक ही मार्ग — **क्रांतिवृत्त (ecliptic)** — के पास बनी रहती थीं। यूनानियों ने इन्हें 'प्लैनेट्स' (भटकने वाले) कहा। हम इन्हें ग्रह कहते हैं।",
          "शनि इन भटकने वालों में देखने के लिए सबसे संतोषजनक है। एक साधारण टेलीस्कोप भी इसके विशिष्ट **वलय (rings)** को स्पष्ट कर देता है — असल में ये अरबों बर्फ़ीले कणों से बने हैं, जो ग्रह से भी चौड़े एक चक्र में कागज़ से भी पतले फैले हैं। शनि के वलय अपनी लगभग 29.5-वर्षीय कक्षा के दौरान पृथ्वी की ओर झुकते और दूर होते रहते हैं, इसलिए मानव जीवनकाल में दृश्य धीरे-धीरे बदलता है — पूरी तरह खुले वलयों से लेकर एक पतली रेखा जैसी धार तक, और फिर वापस।",
          "चूँकि शनि बहुत दूर है, तारों के बीच इसकी स्थिति रात-दर-रात लगभग नहीं बदलती — चंद्रमा के विपरीत, जो कुछ ही घंटों में स्पष्ट रूप से अपनी जगह से खिसकता दिखता है। हर रात जो चीज़ बदलती है वह है शनि का उगने और डूबने का स्थान — जो पूरी तरह पृथ्वी के अपने घूर्णन से तय होता है। यह सिम्युलेटर ठीक उसी तरह इस गति की गणना करता है जैसे असली वेधशालाएँ करती हैं: शनि की कैटलॉग स्थिति (Right Ascension और Declination) के साथ-साथ आपके स्थान और वर्तमान समय से।",
          "शनि के वलयों को स्पष्ट रूप से देखने के लिए, ग्रह के बेहद छोटे आभासी आकार पर काबू पाने के लिए पर्याप्त आवर्धन चाहिए — लेकिन इतना भी नहीं कि वायुमंडल छवि को कँपकँपाते धुंधलेपन में बदल दे। रात-दर-रात इस सही संतुलन को ढूँढ़ना ही ग्रहीय अवलोकन की पूरी कला है।",
        ],
      },
    },
  },
  {
    id: 'jovian_system',
    targetId: 'jupiter',
    achievementId: 'jovian_observer',
    content: {
      en: {
        title: 'The Jovian System: Galileo’s Moons',
        body: [
          "In January 1610, Galileo Galilei pointed his small telescope — barely 20×, worse than this simulator's finderscope — at the brilliant planet Jupiter. Beside it he saw three faint 'stars' arranged in a perfectly straight line. The next night the little stars had MOVED. Over the following weeks a fourth appeared, and the four kept rearranging themselves night after night — sometimes bunched on one side, sometimes spread on both, sometimes one simply vanished.",
          "The pattern gave the game away: the four points never wandered off; they only swung back and forth along one line through Jupiter, each with its own strict rhythm — **Io** completes a lap in about 1.8 days, **Europa** in 3.6, **Ganymede** in 7.2, **Callisto** in 16.7. (Notice the near-perfect 1:2:4 rhythm of the inner three — a real orbital **resonance**.) There is only one explanation: they are **moons orbiting Jupiter**, seen edge-on. A 'vanished' moon is one passing behind the planet's disk — an **occultation** — or lost against its glare in front.",
          "Why did this matter so much? In 1610, established doctrine held that EVERYTHING in the heavens orbits the Earth. Yet here were four bodies visibly, measurably orbiting **another planet** — the first direct observational proof that Earth is not the center of every motion in the universe. Galileo rushed the discovery into print in his book **Sidereus Nuncius** ('The Starry Messenger'), and astronomy was never the same again.",
          "Now repeat his experiment — in minutes instead of weeks. Use the button below to slew to Jupiter, then advance the clock with the **+1 HOUR** button or raise the playback speed. Watch the line of bright dots stretch, flip sides, and shed a moon behind the disk exactly on schedule. On an Alt-Az mount the whole system also slowly tilts over the session — that's the field rotation you met in Lesson 2, now acting on an entire miniature planetary system.",
        ],
      },
      hi: {
        title: 'गुरु (बृहस्पति) का परिवार: गैलीलियो के चंद्रमा',
        body: [
          "जनवरी 1610 में गैलीलियो गैलिली ने अपना छोटा-सा टेलीस्कोप — मुश्किल से 20×, इस सिम्युलेटर के फाइंडरस्कोप से भी कमज़ोर — चमकते ग्रह बृहस्पति की ओर घुमाया। उसके बगल में उसे तीन धुंधले 'तारे' एक बिल्कुल सीधी रेखा में दिखे। अगली रात वे नन्हे तारे अपनी जगह से खिसक चुके थे। अगले हफ़्तों में एक चौथा भी प्रकट हुआ, और चारों रात-दर-रात अपनी जगहें बदलते रहे — कभी एक ओर इकट्ठा, कभी दोनों ओर फैले, और कभी कोई एक सिरे से ग़ायब ही हो जाता।",
          "इसी पैटर्न ने राज़ खोल दिया: चारों बिंदु कभी बृहस्पति से दूर नहीं भटकते थे; वे केवल उसी एक रेखा पर आगे-पीछे झूलते थे, हर एक अपनी सटीक लय में — **आयो (Io)** लगभग 1.8 दिन में एक चक्कर पूरा करता है, **यूरोपा (Europa)** 3.6 में, **गैनीमीड (Ganymede)** 7.2 में, और **कैलिस्टो (Callisto)** 16.7 दिन में। (भीतरी तीनों की लगभग 1:2:4 की लय पर गौर करें — यह एक वास्तविक कक्षीय **अनुनाद (resonance)** है।) इसकी एक ही व्याख्या संभव थी: ये **बृहस्पति की परिक्रमा करते चंद्रमा** हैं, जिन्हें हम किनारे से (edge-on) देख रहे हैं। 'ग़ायब' हुआ चंद्रमा वह है जो ग्रह की तश्तरी के पीछे से गुज़र रहा हो — जिसे **प्रच्छादन (occultation)** कहते हैं।",
          "यह इतना महत्वपूर्ण क्यों था? 1610 में प्रचलित मान्यता यह थी कि आकाश की हर चीज़ पृथ्वी की परिक्रमा करती है। लेकिन यहाँ चार पिंड आँखों के सामने, नापे जा सकने लायक ढंग से, **एक दूसरे ग्रह** की परिक्रमा कर रहे थे — यह पहला प्रत्यक्ष अवलोकनात्मक प्रमाण था कि ब्रह्मांड की हर गति का केंद्र पृथ्वी नहीं है। गैलीलियो ने यह खोज तुरंत अपनी पुस्तक **साइडेरियस नुन्सियस (Sidereus Nuncius — 'तारों का संदेशवाहक')** में छापी, और खगोल विज्ञान हमेशा के लिए बदल गया।",
          "अब उसी प्रयोग को दोहराइए — हफ़्तों के बजाय मिनटों में। नीचे दिए बटन से बृहस्पति की ओर टेलीस्कोप घुमाइए, फिर **+1 HOUR** बटन से घड़ी आगे बढ़ाइए या प्लेबैक गति तेज़ कीजिए। देखिए कैसे चमकते बिंदुओं की रेखा फैलती है, पाला बदलती है, और ठीक तय समय पर कोई चंद्रमा तश्तरी के पीछे ओझल हो जाता है। अल्ट-एज़िमुथ माउंट पर पूरा तंत्र सत्र के दौरान धीरे-धीरे झुकता भी जाता है — यह वही फील्ड रोटेशन है जो आपने पाठ 2 में सीखा था, अब एक पूरे लघु ग्रह-तंत्र पर लागू होता हुआ। आप विज्ञान के इतिहास के सबसे महत्वपूर्ण अवलोकनों में से एक को स्वयं दोहरा रहे हैं।",
        ],
      },
    },
  },
];

/** Pure lookup with an English fallback — mirrors engine/i18n.ts's translate(). */
export function getLessonContent(language: Language, lesson: Lesson): LessonContent {
  return lesson.content[language] ?? lesson.content.en;
}

/**
 * Marks a lesson complete once its practical hook's real completion signal
 * fires — a Rank Curriculum mission achievement, or a module's completedModules
 * entry. Called from App.tsx's existing progress-evaluation useEffect, same
 * spot as evaluateMissionProgress / evaluateRankMissionProgress.
 */
export function evaluateLessonCompletion(): void {
  const progress = useProgressStore.getState();
  for (const lesson of CURRICULUM) {
    if (progress.completedLessons.includes(lesson.id)) continue;
    const missionDone = !!lesson.missionId && progress.achievements.includes(lesson.missionId);
    const moduleDone = !!lesson.completionModuleId && progress.completedModules.includes(lesson.completionModuleId);
    const achievementDone = !!lesson.achievementId && progress.achievements.includes(lesson.achievementId);
    if (missionDone || moduleDone || achievementDone) {
      progress.completeLesson(lesson.id);
    }
  }
}
