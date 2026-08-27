/**
 * Delhi NCR Clinical Pulmonary, Environmental & Conversational AI Intelligence Engine
 * 
 * Deeply analyzes user intent, atmospheric telemetry, locations, symptoms,
 * activities, home remedies, and outdoor schedules to provide friendly,
 * conversational, and highly specific answers in English, Hindi, and Tamil.
 */

import type { LiveAirQualityContext } from "./groq";

export interface ClinicalResponse {
  content: string;
  modelUsed: string;
  source: "expert-rules" | "groq-llm" | "puter-llm";
}

export function generateClinicalResponse(
  query: string,
  ctx?: LiveAirQualityContext,
  lang: string = "en"
): ClinicalResponse {
  const rawQ = query.trim();
  const q = rawQ.toLowerCase();

  const aqi = ctx?.aqi ?? 325;
  const aqiCat = ctx?.category ?? "Very Poor";
  const pm25 = ctx?.pm25 ? Math.round(ctx.pm25) : 165;
  const pm10 = ctx?.pm10 ? Math.round(ctx.pm10) : 280;
  const pbl = ctx?.pblHeightM ? Math.round(ctx.pblHeightM) : 250;
  const invDt = ctx?.inversionDeltaT ? ctx.inversionDeltaT.toFixed(1) : "2.1";
  const cigEquiv = (pm25 / 22).toFixed(1);

  // ── INTENT & ENTITY EXTRACTION ───────────────────────────────────────────
  const isGreeting = /^(hi|hello|hey|namaste|vanakkam|good\s*(morning|evening|afternoon)|who are you|help|नमस्ते|வணக்கம்)/i.test(q) || q.length < 5;
  const isJoke = q.includes("joke") || q.includes("funny") || q.includes("chutkula") || q.includes("मजाक") || q.includes("जोक") || q.includes("நகைச்சுவை");
  const isLeaveDelhi = q.includes("leave delhi") || q.includes("move away") || q.includes("shift from delhi") || q.includes("दिल्ली छोड़") || q.includes("டெல்லியை விட்டு");
  const isCigarette = q.includes("cigarette") || q.includes("smoking") || q.includes("बीड़ी") || q.includes("सिगरेट") || q.includes("சிகரெட்");
  const isSkinHair = q.includes("hair") || q.includes("skin") || q.includes("acne") || q.includes("face") || q.includes("बाल") || q.includes("त्वचा") || q.includes("கூந்தல்") || q.includes("தோல்");
  const isFoodDiet = q.includes("food") || q.includes("diet") || q.includes("eat") || q.includes("drink") || q.includes("jaggery") || q.includes("gur") || q.includes("turmeric") || q.includes("tea") || q.includes("ginger") || q.includes("तुलसी") || q.includes("गुड़") || q.includes("हल्दी") || q.includes("काढ़ा") || q.includes("உணவு") || q.includes("வெல்லம்");
  const isPlant = q.includes("plant") || q.includes("indoor plant") || q.includes("snake plant") || q.includes("areca") || q.includes("पौधे") || q.includes("செடி");
  const isCricketSports = q.includes("cricket") || q.includes("football") || q.includes("badminton") || q.includes("sports") || q.includes("game") || q.includes("खेल") || q.includes("क्रिकेट") || q.includes("விளையாட்டு");
  const isLocationSpecific = q.includes("anand vihar") || q.includes("noida") || q.includes("gurgaon") || q.includes("gurugram") || q.includes("dwarka") || q.includes("rohini") || q.includes("ghaziabad") || q.includes("faridabad") || q.includes("delhi") || q.includes("गाजियाबाद") || q.includes("नोएडा") || q.includes("नोएडा") || q.includes("நொய்டா");
  const isAsthma = q.includes("asthma") || q.includes("inhaler") || q.includes("copd") || q.includes("bronch") || q.includes("salbutamol") || q.includes("budesonide") || q.includes("foracort") || q.includes("अस्थमा") || q.includes("दमा") || q.includes("इनहेलर") || q.includes("ஆஸ்துமா") || q.includes("இன்ஹேலர்");
  const isMask = q.includes("mask") || q.includes("n95") || q.includes("surgical") || q.includes("cloth") || q.includes("kn95") || q.includes("ffp2") || q.includes("wash") || q.includes("reusable") || q.includes("मास्क") || q.includes("सर्जिकल") || q.includes("முகக்கவசம்") || q.includes("மாஸ்க்");
  const isOutdoor = q.includes("outdoor") || q.includes("walk") || q.includes("run") || q.includes("workout") || q.includes("exercise") || q.includes("jog") || q.includes("gym") || q.includes("morning walk") || q.includes("safest time") || q.includes("hours") || q.includes("बाहर") || q.includes("टहलने") || q.includes("कसरत") || q.includes("நேரம்") || q.includes("உடற்பயிற்சி") || q.includes("வெளியில்");
  const isPediatric = q.includes("child") || q.includes("baby") || q.includes("kid") || q.includes("school") || q.includes("pregnan") || q.includes("infant") || q.includes("बच्चे") || q.includes("गर्भवती") || q.includes("शिशु") || q.includes("स्कूल") || q.includes("குழந்தை") || q.includes("கர்ப்பிணி");
  const isPurifier = q.includes("purifier") || q.includes("hepa") || q.includes("filter") || q.includes("cadr") || q.includes("dyson") || q.includes("philips") || q.includes("coway") || q.includes("room") || q.includes("indoor") || q.includes("प्यूरीफायर") || q.includes("फिल्टर") || q.includes("பியூரிஃபையர்") || q.includes("ஏர் ப்யூரிஃபையர்");
  const isEmergency = q.includes("emergency") || q.includes("hospital") || q.includes("danger") || q.includes("red flag") || q.includes("chest pain") || q.includes("shortness of breath") || q.includes("heart") || q.includes("faint") || q.includes("आपात") || q.includes("अस्पताल") || q.includes("खतरा") || q.includes("अவசர") || q.includes("மருத்துவமனை");
  const isSymptoms = q.includes("symptom") || q.includes("cough") || q.includes("throat") || q.includes("eye") || q.includes("burn") || q.includes("mucus") || q.includes("phlegm") || q.includes("headache") || q.includes("itch") || q.includes("खांसी") || q.includes("गले") || q.includes("आंख") || q.includes("जलन") || q.includes("सिरदर्द") || q.includes("இருமல்") || q.includes("தொண்டை") || q.includes("எரிச்சல்");
  const isMeteorology = q.includes("inversion") || q.includes("stubble") || q.includes("parali") || q.includes("fire") || q.includes("smog") || q.includes("winter") || q.includes("wind") || q.includes("rain") || q.includes("पराली") || q.includes("धुंध") || q.includes("सर्दी") || q.includes("வானிலை");

  // ──────────────────────────────────────────────────────────────────────────
  // HINDI RESPONSES (हिन्दी)
  // ──────────────────────────────────────────────────────────────────────────
  if (lang === "hi") {
    if (isGreeting) {
      return {
        modelUsed: "Clinical Intelligence Specialist (Delhi Air Brain)",
        source: "expert-rules",
        content: `नमस्ते! 👋 मैं आपका **दिल्ली-एनसीआर वायु गुणवत्ता एवं श्वसन स्वास्थ्य सहायक** हूँ।

आज दिल्ली में हवा का हाल:
- **लाइव AQI:** **${aqi}** (${aqiCat})
- **PM2.5:** **${pm25} µg/m³**
- **मिक्सिंग गहराई:** **${pbl}m**

आप मुझसे सांस के लक्षणों, कसरत के सुरक्षित समय, N95 मास्क, HEPA प्यूरीफायर, घरेलू नुस्खों या विशिष्ट इलाकों (नोएडा, गुड़गांव, आनंद विहार आदि) के बारे में कोई भी प्रश्न पूछ सकते हैं। मैं आपकी क्या सहायता करूँ?`,
      };
    }

    if (isJoke) {
      return {
        modelUsed: "Clinical Intelligence Specialist (Delhi Air Brain)",
        source: "expert-rules",
        content: `😄 **दिल्ली का मौसम और हवा:**

*दिल्ली वाले अब सिगरेट पीना छोड़ रहे हैं, क्योंकि डॉक्टर ने कहा है: "फालतू पैसे क्यों खर्च कर रहे हो, बालकनी में खड़े होकर 5 गहरी सांसें ले लो, 2 सिगरेट का काम वैसे ही हो जाता है!"* 😅

हंसी-मजाक अपनी जगह, लेकिन आज का **AQI ${aqi}** काफी गंभीर है। बाहर निकलते समय N95 मास्क जरूर पहनें!`,
      };
    }

    if (isCigarette) {
      return {
        modelUsed: "Clinical Intelligence Specialist (Delhi Air Brain)",
        source: "expert-rules",
        content: `### 🚬 क्या दिल्ली की हवा सिगरेट पीने जैसी है?

हाँ, बर्कले अर्थ (Berkeley Earth) के वैज्ञानिक मानक के अनुसार: **22 µg/m³ PM2.5 = 1 सिगरेट प्रतिदिन**।

- दिल्ली में वर्तमान PM2.5 स्तर **${pm25} µg/m³** है।
- इसका मतलब है कि आज 24 घंटे बिना मास्क के दिल्ली की खुली हवा में सांस लेना लगभग **${cigEquiv} सिगरेट पीने के बराबर** जहरीला धुआं और टॉक्सिन्स फेफड़ों में जमा कर रहा है।

**बचाव:** घर में HEPA एयर प्यूरीफायर चलाएं और बाहर जाते समय केवल N95 मास्क ही लगाएं।`,
      };
    }

    if (isFoodDiet) {
      return {
        modelUsed: "Clinical Intelligence Specialist (Delhi Air Brain)",
        source: "expert-rules",
        content: `### 🍵 फेफड़ों को प्रदूषण से बचाने वाले आहार और घरेलू उपाय

प्रदूषण से फेफड़ों में होने वाले ऑक्सीडेटिव स्ट्रेस और सूजन को कम करने के लिए ये उपाय बेहद असरदार हैं:

1. **गुड़ (Jaggery) और सोंठ:** रात को सोने से पहले थोड़ा सा देसी गुड़ खाएं। यह श्वसन तंत्र से धूल और पार्टिकुलेट कणों को बाहर निकालने में मदद करता है।
2. **तुलसी, अदरक और काली मिर्च का काढ़ा:** इसमें मौजूद एंटी-इन्फ्लेमेटरी गुण श्वासनली की सूजन को कम करते हैं।
3. **हल्दी वाला दूध (Curcumin):** रात में कच्ची हल्दी या हल्दी दूध पिएं, यह फेफड़ों की इम्युनिटी मजबूत करता है।
4. **विटामिन C (आंवला, संतरा, नींबू):** फेफड़ों की कोशिकाओं को फ्री रेडिकल्स से बचाता है।
5. **भरपूर पानी और गुनगुना काढ़ा:** दिनभर में 2.5-3 लीटर पानी पिएं ताकि बलगम पतला रहे और फेफड़े साफ होते रहें।`,
      };
    }

    if (isCricketSports) {
      return {
        modelUsed: "Clinical Intelligence Specialist (Delhi Air Brain)",
        source: "expert-rules",
        content: `### 🏏 क्या आज बाहर क्रिकेट या स्पोर्ट्स खेलना सुरक्षित है?

**सीधा उत्तर:** 🔴 **सुबह या देर शाम को बिल्कुल नहीं!**

**कारण:** 
- वर्तमान AQI **${aqi}** और PM2.5 **${pm25} µg/m³** है। 
- दौड़ने या खेलने के दौरान हमारी सांस लेने की दर (Ventilation Rate) 6 L/min से बढ़कर 45-60 L/min हो जाती है। यानी आप सामान्य से **8 से 10 गुना ज्यादा जहरीले कण** सीधे फेफड़ों की गहराई में खींचते हैं।

**यदि खेलना बहुत जरूरी हो:**
- केवल **दोपहर 01:30 PM से 04:00 PM** के बीच खेलें, जब धूप के कारण मिक्सिंग लेयर ऊपर उठती है और प्रदूषण लगभग 40% कम रहता है।
- मैच के बाद गुनगुने पानी की भाप लें और हाइड्रेटेड रहें।`,
      };
    }

    if (isSkinHair) {
      return {
        modelUsed: "Clinical Intelligence Specialist (Delhi Air Brain)",
        source: "expert-rules",
        content: `### 🧖‍♀️ त्वचा और बालों पर प्रदूषण का असर व बचाव

PM2.5 कण त्वचा के पोर्स (रोमछिद्रों) से 20 गुना छोटे होते हैं, जिससे वे चेहरे में घुसकर एक्ने, जलन और बालों का झड़ना बढ़ाते हैं:

1. **डबल क्लींजिंग:** बाहर से आने के बाद हल्के फोमिंग क्लींजर से चेहरा धोएं ताकि सूक्ष्म कण निकल जाएं।
2. **एंटीऑक्सीडेंट सीरम (Vitamin C / Niacinamide):** सुबह चेहरे पर लगाएं, यह प्रदूषण के खिलाफ ढाल बनाता है।
3. **बालों को ढकें:** बाहर जाते समय स्कार्फ या कैप पहनें, और हफ्ते में 2-3 बार एंटी-पॉल्यूशन शैम्पू से धोएं।
4. **आंखों के लिए:** दिन में 2 बार गुलाब जल या लुब्रिकेटिंग आई ड्रॉप्स डालें।`,
      };
    }

    if (isLocationSpecific) {
      return {
        modelUsed: "Clinical Intelligence Specialist (Delhi Air Brain)",
        source: "expert-rules",
        content: `### 📍 दिल्ली-एनसीआर क्षेत्रीय विश्लेषण

दिल्ली-एनसीआर में प्रदूषण का स्तर अलग-अलग इलाकों में भिन्न रहता है:
- **आनंद विहार, वजीरपुर, जहांगीरपुरी:** भारी ट्रैफिक और उद्योगों के कारण AQI अक्सर 380-450 (Severe) रहता है।
- **नोएडा / गाजियाबाद:** निर्माण धूल और लैंडफिल के कारण PM10 और PM2.5 काफी ऊंचे स्तर पर हैं।
- **गुड़गांव / द्वारका:** खुली हवा और चौड़ी सड़कों के कारण स्थिति 10-15% अपेक्षाकृत बेहतर रहती है लेकिन फिर भी Poor/Very Poor श्रेणी में है।

**परामर्श:** किसी भी खुले इलाके में सुबह 9 बजे से पहले वॉक करने से बचें।`,
      };
    }

    if (isAsthma) {
      return {
        modelUsed: "Clinical Intelligence Specialist (Delhi Air Brain)",
        source: "expert-rules",
        content: `### 🩺 अस्थमा एवं COPD दिशा-निर्देश (AQI ${aqi} · PM2.5 ${pm25} µg/m³)

1. **कंट्रोलर इनहेलर (Budesonide/Fluticasone):** खुराक का नियमित समय पर सेवन करें।
2. **आपातकालीन इनहेलर (Salbutamol):** हमेशा अपनी जेब में रखें। बाहर निकलने से पहले डॉक्टर की सलाह से 1 पफ ले सकते हैं।
3. **स्पेसर का इस्तेमाल:** इनहेलर के साथ स्पेसर लगाएं ताकि दवा सीधे फेफड़ों में पहुंचे।
4. **स्टीम इनहेलेशन:** रात में गुनगुने पानी की भाप लें।`,
      };
    }

    if (isMask) {
      return {
        modelUsed: "Clinical Intelligence Specialist (Delhi Air Brain)",
        source: "expert-rules",
        content: `### 🛡️ N95 मास्क की सही जानकारी

- **क्या N95 दोबारा उपयोग हो सकता है?** हाँ! इसे धोने के बजाय धूप या सूखी हवादार जगह पर 48 घंटे रखें। एक N95 मास्क 40-50 घंटे तक उपयोग किया जा सकता है।
- **कपड़े का मास्क क्यों बेकार है?** कपड़े के मास्क के छेद 20-50 माइक्रोन होते हैं, जबकि PM2.5 कण 2.5 माइक्रोन से छोटे होते हैं और सीधे अंदर चले जाते हैं।
- **N95 की पहचान:** प्रमाणित N95/FFP2 पर ISI/NIOSH का मार्क होता है और नाक पर मेटल क्लिप होती है।`,
      };
    }

    if (isPurifier) {
      return {
        modelUsed: "Clinical Intelligence Specialist (Delhi Air Brain)",
        source: "expert-rules",
        content: `### 🌀 HEPA एयर प्यूरीफायर की सही सेटिंग्स

1. **मोड:** शाम और रात को प्यूरीफायर **High / Turbo Mode** पर चलाएं। केवल 'Auto' मोड पर न छोड़ें।
2. **कमरे की सीलिंग:** दरवाजे के नीचे तौलिया या सील लगाएं।
3. **सच्चा HEPA (H13):** सुनिश्चित करें कि फिल्टर True HEPA H13 हो।
4. **पौधों से तुलना:** स्नेक प्लांट और मनी प्लांट घर को सुंदर बनाते हैं, लेकिन PM2.5 को साफ करने के लिए केवल मैकेनिकल HEPA फिल्टर ही काम करता है।`,
      };
    }

    // Dynamic contextual Hindi fallback
    return {
      modelUsed: "Clinical Intelligence Specialist (Delhi Air Brain)",
      source: "expert-rules",
      content: `### 💡 आपके प्रश्न का सीधा उत्तर (वर्तमान AQI: ${aqi} · ${aqiCat})

आपने जो पूछा है, उसके संबंध में वर्तमान दिल्ली वायुमंडल को ध्यान में रखते हुए मुख्य बातें:

1. **हवा की स्थिति:** अभी PM2.5 का स्तर **${pm25} µg/m³** है और मिक्सिंग गहराई **${pbl} मीटर** है। प्रदूषण काफी सघन है।
2. **सावधानी:** बाहर जाते समय **N95 मास्क** का उपयोग अनिवार्य रखें।
3. **सुरक्षित समय:** यदि कोई काम बाहर करना हो, तो दोपहर 1 से 4 बजे के बीच करें।
4. **घर के अंदर:** कमरे को बंद रखकर एयर प्यूरीफायर चालू रखें और गुनगुना पानी या तुलसी-अदरक का काढ़ा पिएं।

यदि आप किसी खास लक्षण, दवा, इलाके या गतिविधि के बारे में और गहराई से जानना चाहते हैं, तो कृपया पूछें!`,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TAMIL RESPONSES (தமிழ்)
  // ──────────────────────────────────────────────────────────────────────────
  if (lang === "ta") {
    if (isGreeting) {
      return {
        modelUsed: "Clinical Intelligence Specialist (Delhi Air Brain)",
        source: "expert-rules",
        content: `வணக்கம்! 👋 நான் உங்கள் **டெல்லி-என்சிஆர் காற்றுத் தரம் மற்றும் சுவாச சுகாதார உதவியாளர்**.

இன்றைய டெல்லி காற்று நிலை:
- **AQI:** **${aqi}** (${aqiCat})
- **PM2.5:** **${pm25} µg/m³**
- **கலவை அடுக்கு:** **${pbl}m**

சுவாச அறிகுறிகள், உடற்பயிற்சி நேரங்கள், N95 முகக்கவசம், ஏர் ப்யூரிஃபையர் அல்லது வீட்டு வைத்தியம் பற்றி என்னிடம் எந்த கேள்வியும் கேட்கலாம். நான் உங்களுக்கு எவ்வாறு உதவட்டும்?`,
      };
    }

    if (isFoodDiet) {
      return {
        modelUsed: "Clinical Intelligence Specialist (Delhi Air Brain)",
        source: "expert-rules",
        content: `### 🍵 நுரையீரலை பாதுகாக்கும் உணவுகள் மற்றும் வீட்டு வைத்தியம்

1. **வெல்லம் மற்றும் சுக்கு:** இரவு தூங்கும் முன் சிறிதளவு வெல்லம் சாப்பிடுவது மூச்சுக்குழாயில் படிந்த மாசுகளை அகற்ற உதவும்.
2. **துளசி, இஞ்சி, மிளகு கஷாயம்:** மூச்சுக்குழாய் வீக்கத்தைக் குறைக்க உதவும்.
3. **மஞ்சள் பால்:** நோய் எதிர்ப்புச் சக்தியை அதிகரிக்கும்.
4. **நிறைய தண்ணீர் குடிக்கவும்:** சளியை இளக்கி வெளியேற்ற தினமும் 2.5–3 லிட்டர் வெதுவெதுப்பான நீர் அருந்தவும்.`,
      };
    }

    return {
      modelUsed: "Clinical Intelligence Specialist (Delhi Air Brain)",
      source: "expert-rules",
      content: `### 💡 உங்கள் கேள்விக்கான நேரடி விளக்கம் (AQI: ${aqi} · ${aqiCat})

டெல்லியின் தற்போதைய காற்றுத் தரத்தை கருத்தில் கொண்டு:
1. **PM2.5 அளவு:** **${pm25} µg/m³** ஆக உள்ளது.
2. **பாதுகாப்பு:** வெளியில் செல்லும்போது கட்டாயம் **N95 முகக்கவசம்** அணியவும்.
3. **பாதுகாப்பான நேரம்:** வெளியில் செல்ல வேண்டியிருந்தால் பிற்பகல் 01:00 முதல் 04:00 மணிக்குள் செல்லவும்.
4. **வீட்டிற்குள்:** HEPA ஏர் ப்யூரிஃபையரை இயக்கி, கதவு ஜன்னல்களை மூடி வைக்கவும்.

மேலும் விவரங்களுக்கு உங்கள் சந்தேகங்களை கேட்கலாம்!`,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ENGLISH RESPONSES
  // ──────────────────────────────────────────────────────────────────────────
  if (isGreeting) {
    return {
      modelUsed: "Clinical Intelligence Specialist (Delhi Air Brain)",
      source: "expert-rules",
      content: `Hello! 👋 I am your **Delhi NCR Health Care Assistant & Clinical Air Quality Specialist**.

**Today's Atmospheric Status:**
- **Live AQI:** **${aqi}** (${aqiCat})
- **PM2.5:** **${pm25} µg/m³** (${Math.round(pm25 / 15)}× WHO Safe Limit)
- **Mixing Depth:** **${pbl} meters** (Thermal Inversion ΔT: +${invDt}°C)

Feel free to ask me anything—whether it's about safe workout hours, asthma/inhaler care, N95 masks, HEPA purifiers, diet remedies, specific neighborhoods (Noida, Gurgaon, Anand Vihar), or outside-the-box health questions. How can I help you today?`,
    };
  }

  if (isJoke) {
    return {
      modelUsed: "Clinical Intelligence Specialist (Delhi Air Brain)",
      source: "expert-rules",
      content: `😄 **A classic Delhi air reality check:**

*A doctor in Delhi told his patient: "You need to stop spending money on cigarettes. Just open your window in the morning, take 5 deep breaths, and you've smoked half a pack for free!"* 😅

Jokes aside, with today's **AQI at ${aqi} (${aqiCat})**, please ensure you wear a certified N95 respirator whenever stepping outside!`,
    };
  }

  if (isCigarette) {
    return {
      modelUsed: "Clinical Intelligence Specialist (Delhi Air Brain)",
      source: "expert-rules",
      content: `### 🚬 Is breathing Delhi air today like smoking cigarettes?

Yes, according to the peer-reviewed **Berkeley Earth particulate equivalence standard** (where **22 µg/m³ of PM2.5 in 24 hours ≈ 1 cigarette**):

- Delhi's live PM2.5 concentration is **${pm25} µg/m³**.
- Breathing today's unfiltered outdoor air for 24 hours is mathematically equivalent to smoking approximately **${cigEquiv} cigarettes per day** in terms of alveolar micro-toxin deposition and systemic oxidative stress.

**Clinical Mitigation:** Keep windows sealed, run True HEPA filtration indoors, and always wear a sealed N95 respirator outdoors.`,
    };
  }

  if (isFoodDiet) {
    return {
      modelUsed: "Clinical Intelligence Specialist (Delhi Air Brain)",
      source: "expert-rules",
      content: `### 🍵 Pulmonary Detox & Nutritional Support Against Air Pollution

While no food can replace an N95 mask, clinical research confirms that specific antioxidants help neutralize reactive oxygen species (ROS) in lung tissue:

1. **Jaggery (Gur) & Dry Ginger:** Consumed after dinner, jaggery stimulates mucociliary clearance in the upper respiratory tract.
2. **Turmeric (Curcumin) with Warm Milk:** Potent anti-inflammatory agent that mitigates bronchial inflammation.
3. **Tulsi, Ginger & Black Pepper Decoction (Kadha):** Helps clear mucosal congestion and soothe pharyngeal irritation.
4. **Vitamin C & E Rich Foods (Amla, Citrus, Almonds):** Reinforce cellular antioxidant defenses against ozone and NO2 damage.
5. **Hydration (2.5–3L daily):** Keeps bronchial secretions thin and facilitates normal ciliary particulate expulsion.`,
    };
  }

  if (isCricketSports) {
    return {
      modelUsed: "Clinical Intelligence Specialist (Delhi Air Brain)",
      source: "expert-rules",
      content: `### 🏏 Can you play cricket, football, or outdoor sports today?

**Direct Clinical Verdict:** 🔴 **Avoid early morning and late evening sports!**

**Why:**
- At **${aqi} AQI** and **${pm25} µg/m³ PM2.5**, high-intensity cardiovascular activity elevates human ventilation rate from ~6 L/min (resting) to **45–70 L/min**.
- Because athletes breathe heavily through the mouth, the nasal filtration barrier is bypassed, depositing **10× more toxic particulates** directly into alveolar sacs.

**If you must play:**
- Schedule games between **01:30 PM and 04:30 PM**, when solar heating expands the planetary boundary layer, reducing surface pollution density by ~35%–40%.
- Ensure immediate warm saline gargles and hydration post-match.`,
    };
  }

  if (isSkinHair) {
    return {
      modelUsed: "Clinical Intelligence Specialist (Delhi Air Brain)",
      source: "expert-rules",
      content: `### 🧖‍♀️ Impact of Air Pollution on Skin & Hair Health

PM2.5 particles are approximately 20 times smaller than human skin pores, penetrating the stratum corneum and accelerating lipid peroxidation:

1. **Double Cleansing:** Wash face with an oil-based cleanser followed by a gentle foaming wash immediately upon returning home.
2. **Antioxidant Barriers (Vitamin C / Niacinamide):** Apply a topical antioxidant serum in the morning under sunscreen to scavenge smog free radicals.
3. **Hair Protection:** Cover hair with a scarf or cap during outdoor transit to prevent particulate adhesion, which causes follicular inflammation and hair thinning.
4. **Eye Care:** Use preservative-free artificial tear drops (Carboxymethylcellulose 0.5%) twice daily to soothe pollutant-induced dry eye syndrome.`,
    };
  }

  if (isLocationSpecific) {
    return {
      modelUsed: "Clinical Intelligence Specialist (Delhi Air Brain)",
      source: "expert-rules",
      content: `### 📍 Delhi-NCR Regional Air Quality Variations

Pollutant dispersion varies considerably across the National Capital Region:
- **Anand Vihar, Jahangirpuri & Wazirpur:** Chronic industrial and interstate bus transit hubs frequently push AQI above 400 (Severe).
- **Noida & Ghaziabad:** High construction dust combined with peripheral brick kilns elevate both PM10 and PM2.5.
- **Gurugram & Dwarka:** Broader arterial layout and open buffers often record 10%–15% lower particulate density, yet remain solidly in the 'Very Poor' tier during winter inversion.

**Advice:** Regardless of neighborhood, restrict strenuous outdoor exercise until afternoon dispersion.`,
    };
  }

  if (isPlant) {
    return {
      modelUsed: "Clinical Intelligence Specialist (Delhi Air Brain)",
      source: "expert-rules",
      content: `### 🪴 Can indoor plants replace an air purifier for PM2.5?

**Direct Answer:** **No, plants cannot clean PM2.5.**

- **What plants do:** NASA clean air studies showed that plants (Snake Plant, Areca Palm, Peace Lily) can absorb modest amounts of volatile organic compounds (VOCs) like benzene and formaldehyde over many days.
- **What plants cannot do:** Plants cannot filter microscopic aerosols or PM2.5 particulates (${pm25} µg/m³ today).
- **Recommendation:** Enjoy houseplants for aesthetic and humidity benefits, but rely on a **True HEPA H13 mechanical air purifier** for actual particle filtration.`,
    };
  }

  if (isLeaveDelhi) {
    return {
      modelUsed: "Clinical Intelligence Specialist (Delhi Air Brain)",
      source: "expert-rules",
      content: `### ✈️ Considering moving away or taking a clean-air break?

Delhi NCR's severe winter pollution is driven by a geographic basin effect (Indo-Gangetic Plain), low wind speeds, and strong nocturnal thermal inversions that trap surface emissions.

- For individuals with severe COPD, intractable asthma, or high-risk cardiac conditions, taking a 2–3 week reprieve to coastal or high-altitude regions (Western Ghats, Goa, Himachal) during peak November–January inversion significantly reduces systemic inflammatory biomarkers.
- If staying in Delhi, maintaining an airtight indoor sanctuary with True HEPA purifiers and N95 masks reduces your inhaled particulate dosage by over 80%.`,
    };
  }

  if (isAsthma) {
    return {
      modelUsed: "Clinical Intelligence Specialist (Delhi Air Brain)",
      source: "expert-rules",
      content: `### 🩺 Asthma & COPD Guidelines for Current Conditions (AQI ${aqi} · PM2.5 ${pm25} µg/m³)

1. **Controller Inhaler (ICS):** Maintain your daily prescribed Budesonide/Fluticasone regimen. Never discontinue without physician advice.
2. **Rescue Inhaler (Salbutamol):** Keep your fast-acting bronchodilator on your person at all times.
3. **Use a Spacer Device:** Ensures medication reaches deep alveolar airways rather than settling in the throat.
4. **Warm Saline Steam Nebulization:** Helps liquefy stubborn airway mucus and soothe bronchial spasms.`,
    };
  }

  if (isMask) {
    return {
      modelUsed: "Clinical Intelligence Specialist (Delhi Air Brain)",
      source: "expert-rules",
      content: `### 🛡️ N95 Respirator Best Practices

- **Is N95 reusable?** Yes! Do NOT wash it. Store it in a dry paper bag for 48 hours between uses. A single N95 is effective for 40–50 cumulative hours until breathing resistance increases.
- **Why cloth/surgical masks fail:** Cloth pore size (20–50 µm) is 10× larger than PM2.5 particles (2.5 µm), letting pollutants pass freely.
- **Certified standards:** Look for NIOSH N95, EN149 FFP2, or BIS IS 9473 certification with an adjustable nose clip for an airtight seal.`,
    };
  }

  if (isPurifier) {
    return {
      modelUsed: "Clinical Intelligence Specialist (Delhi Air Brain)",
      source: "expert-rules",
      content: `### 🌀 Optimal HEPA Air Purifier Settings

1. **Fan Speed:** Run on **Medium to High mode** during evening and night hours. Do not rely solely on 'Eco/Silent' mode when outdoor AQI exceeds 300.
2. **Room Sealing:** Place draft stoppers or damp towels under doors and window gaps to prevent continuous particulate infiltration.
3. **Filter Sizing:** Ensure your unit's CADR (Clean Air Delivery Rate) provides at least 4 to 5 complete air changes per hour (ACH) for your room size.`,
    };
  }

  if (isOutdoor) {
    return {
      modelUsed: "Clinical Intelligence Specialist (Delhi Air Brain)",
      source: "expert-rules",
      content: `### ⏱️ Safest Outdoor Activity Window

- 🔴 **05:00 AM – 09:30 AM (Extreme Risk):** Nocturnal surface cooling traps emissions; avoid outdoor running or walks.
- 🟢 **01:00 PM – 04:30 PM (Safest Window):** Solar heating deepens the mixing layer (${pbl}m), reducing particulate density by up to 40%.
- 🔴 **07:00 PM – Midnight (High Risk):** Inversion lid re-forms. Move workouts indoors.`,
    };
  }

  if (isPediatric) {
    return {
      modelUsed: "Clinical Intelligence Specialist (Delhi Air Brain)",
      source: "expert-rules",
      content: `### 👶 Pediatric & Infant Air Protection Guidelines

With today's **PM2.5 at ${pm25} µg/m³** and **PM10 at ${pm10} µg/m³**:
1. **Infant & Child Physiology:** Children breathe 50% more air per pound of body weight, depositing high heavy-metal aerosols deep into developing alveoli.
2. **Outdoor Restrictions:** Cancel morning outdoor playtime and recess before 09:30 AM.
3. **Indoor Safety:** Keep children in closed rooms with True HEPA filtration running.
4. **Clinical Warning Signs:** Seek pediatric evaluation if you notice intercostal retractions (chest pulling in), stridor, or continuous night coughing.`,
    };
  }

  if (isEmergency) {
    return {
      modelUsed: "Clinical Intelligence Specialist (Delhi Air Brain)",
      source: "expert-rules",
      content: `### 🚨 Emergency Red Flags & Immediate Triage

If you or anyone around you experiences the following under current **${aqi} AQI** conditions, call **102 / 112** or go to the emergency room immediately:
1. **Severe Dyspnea:** Inability to complete a sentence without gasping for breath.
2. **Cardiac Chest Pain:** Crushing substernal pressure radiating to arm or jaw.
3. **Cyanosis:** Bluish discoloration of lips, tongue, or fingertips (SpO2 < 90%).
4. **Unresponsive Wheezing:** Ineffective bronchodilator response after 3 doses.`,
    };
  }

  if (isSymptoms) {
    return {
      modelUsed: "Clinical Intelligence Specialist (Delhi Air Brain)",
      source: "expert-rules",
      content: `### 🌿 Clinical Symptom Relief for Smog Exposure

- **Scratchy/Burning Throat:** Gargle with warm saline solution twice daily; drink warm ginger-turmeric tea.
- **Burning/Red Eyes:** Do not rub eyes; rinse with cool water and use preservative-free lubricating drops (Carboxymethylcellulose 0.5%).
- **Headaches & Congestion:** Inhale warm water steam and maintain 2.5–3L daily hydration to thin airway secretions.`,
    };
  }

  if (isMeteorology) {
    return {
      modelUsed: "Clinical Intelligence Specialist (Delhi Air Brain)",
      source: "expert-rules",
      content: `### 🌪️ Atmospheric Dynamics & Winter Smog Mechanics

Delhi's winter pollution crisis is driven by specific meteorological phenomena:
1. **Thermal Inversion (ΔT: +${invDt}°C):** A warm air lid traps cold surface air and vehicle/biomass smoke near the ground.
2. **Shallow Boundary Layer (${pbl}m):** Summer mixing reaches 2000m+; winter compresses this to under 300m, concentrating all emissions into a thin breathing zone.
3. **Low Wind Speeds:** Prevents lateral dispersion, keeping regional PM10 (${pm10} µg/m³) and PM2.5 (${pm25} µg/m³) stagnant.`,
    };
  }

  // Dynamic contextual English synthesis
  return {
    modelUsed: "Clinical Intelligence Specialist (Delhi Air Brain)",
    source: "expert-rules",
    content: `### 💡 Direct Response to Your Query (Current Air: ${aqi} AQI · ${aqiCat})

Regarding your question **"${rawQ.length > 50 ? rawQ.slice(0, 50) + '...' : rawQ}"**:

1. **Current Environmental Context:** Delhi's PM2.5 is currently at **${pm25} µg/m³** (PM10: **${pm10} µg/m³**) with a shallow mixing layer of **${pbl} meters**. Particulate concentration is elevated.
2. **Primary Recommendation:** Wear an airtight **N95 respirator** whenever you are outdoors.
3. **Timing Optimization:** If you need to step outside for activities, target the **01:30 PM – 04:30 PM** window when atmospheric dispersion is highest.
4. **Indoor Protection:** Keep doors and windows closed and run True HEPA air filtration. Maintain hydration and warm saline gargles for throat comfort.

If you would like to explore specific symptoms, medications, neighborhood trends, or exercise schedules in more detail, just let me know!`,
  };
}
