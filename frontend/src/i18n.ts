export type LanguageCode = 'en' | 'te' | 'hi';

type Translations = {
  [key in LanguageCode]: {
    [key: string]: string;
  };
};

export const translations: Translations = {
  en: {
    appTitle: 'JanNaadi',
    submitGrievance: 'Submit Grievance',
    voiceInstruction: 'Tap to record your voice',
    textInstruction: 'Or type your issue here...',
    photoInstruction: 'Attach a photo',
    wardLabel: 'Select Ward',
    submitBtn: 'Submit',
    submitting: 'Submitting...',
    successTitle: 'Submission Received',
    successMsg: 'Your submission ID is',
    status: 'Status',
    dashboardTitle: 'MP Dashboard',
    deadlettersTitle: 'Dead Letters',
    rank: 'Rank',
    score: 'Score',
    inDevPlan: 'In dev plan',
    categoryLabel: 'Category',
    allWards: 'All Wards',
    allCategories: 'All Categories'
  },
  te: {
    appTitle: 'జన్ నాడి',
    submitGrievance: 'ఫిర్యాదు చేయండి',
    voiceInstruction: 'రికార్డ్ చేయడానికి నొక్కండి',
    textInstruction: 'లేదా మీ సమస్యను ఇక్కడ టైప్ చేయండి...',
    photoInstruction: 'ఫోటోను జత చేయండి',
    wardLabel: 'వార్డును ఎంచుకోండి',
    submitBtn: 'సమర్పించండి',
    submitting: 'సమర్పిస్తున్నాము...',
    successTitle: 'సమర్పణ స్వీకరించబడింది',
    successMsg: 'మీ సమర్పణ ID:',
    status: 'స్థితి',
    dashboardTitle: 'MP డాష్‌బోర్డ్',
    deadlettersTitle: 'డెడ్ లెటర్స్',
    rank: 'ర్యాంక్',
    score: 'స్కోర్',
    inDevPlan: 'ప్రణాళికలో ఉంది',
    categoryLabel: 'వర్గం',
    allWards: 'అన్ని వార్డులు',
    allCategories: 'అన్ని వర్గాలు'
  },
  hi: {
    appTitle: 'जन नाड़ी',
    submitGrievance: 'शिकायत दर्ज करें',
    voiceInstruction: 'रिकॉर्ड करने के लिए टैप करें',
    textInstruction: 'या अपनी समस्या यहाँ टाइप करें...',
    photoInstruction: 'फोटो संलग्न करें',
    wardLabel: 'वार्ड चुनें',
    submitBtn: 'जमा करें',
    submitting: 'जमा कर रहे हैं...',
    successTitle: 'प्रस्तुति प्राप्त हुई',
    successMsg: 'आपकी प्रस्तुति ID है:',
    status: 'स्थिति',
    dashboardTitle: 'सांसद डैशबोर्ड',
    deadlettersTitle: 'डेड लेटर्स',
    rank: 'रैंक',
    score: 'स्कोर',
    inDevPlan: 'योजना में है',
    categoryLabel: 'श्रेणी',
    allWards: 'सभी वार्ड',
    allCategories: 'सभी श्रेणियां'
  }
};
