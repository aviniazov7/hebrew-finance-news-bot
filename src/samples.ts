import { DEFAULT_CATEGORIES } from "./catalog.ts";
import { DEFAULT_DISCLAIMER } from "./config.ts";
import { formatTelegramMessage, type FormatInput } from "./format.ts";

interface SampleDraft {
  headline: string;
  summary: string;
  marketMeaning: string;
  glossary: FormatInput["glossary"];
  sourceName: string;
  sourceUrl: string;
}

const DRAFTS: Record<string, SampleDraft> = {
  crypto: {
    headline: "ביטקוין נחלש אחרי אזהרת רגולציה בארה״ב",
    summary:
      "רגולטור בארה״ב הודיע שיבדוק כמה בורסות קריפטו גדולות. ביטקוין ירד תוך שעות, ויחד איתו נחלשו גם מטבעות גדולים אחרים. בשלב הזה לא פורסם קנס ולא צו סגירה.",
    marketMeaning:
      "כשיוצאת אזהרת רגולציה חדה, מחירי הקריפטו נוטים לזוז מהר, ולפעמים גם מניות של חברות שמחזיקות ביטקוין זזות איתם.",
    glossary: [
      {
        term: "ETF",
        hebrew: "קרן סל",
        explanation: "מוצר שנסחר בבורסה כמו מניה ועוקב אחרי מדד או אחרי ביטקוין, בלי שצריך לקנות את המטבע עצמו.",
      },
    ],
    sourceName: "CoinDesk",
    sourceUrl: "https://example.com/fixtures/crypto",
  },
  stocks: {
    headline: "וול סטריט נסגרה בירידות אחרי דוחות מעורבים",
    summary:
      "מדדי המניות הגדולים בארה״ב ירדו ביום מסחר שבו חלק מהחברות עקפו את תחזית הרווח וחלק פספסו. ירידות חדות יותר נראו במניות שבבים. לא פורסם אירוע חירום במסחר.",
    marketMeaning: "יום מעורב כזה בדרך כלל מגדיל את התנודות במדדים, בלי לשנות לבד את כיוון הריבית או את שוק האג״ח.",
    glossary: [
      {
        term: "index",
        hebrew: "מדד",
        explanation: "מספר שמרכז את מחירי קבוצת מניות, למשל 500 החברות הגדולות בארה״ב, כדי לראות איך השוק זז.",
      },
    ],
    sourceName: "CNBC Finance",
    sourceUrl: "https://example.com/fixtures/stocks",
  },
  markets: {
    headline: "שוקי ההון נערכים ליום מסחר תנודתי סביב החלטת ריבית",
    summary:
      "סוחרים הזיזו כסף בין מניות לאג״ח לקראת החלטת הבנק המרכזי. מחזורי המסחר עלו כבר לפני ההודעה. אין עדיין החלטה רשמית.",
    marketMeaning:
      "ככל שההחלטה מתקרבת, פערי המחירים בין קונים למוכרים יכולים להתרחב, ולכן תנועה חדה בשני הכיוונים אפשרית מיד אחרי ההודעה.",
    glossary: [
      {
        term: "liquidity",
        hebrew: "נזילות",
        explanation: "כמה קל לקנות או למכור נכס בלי להזיז את המחיר שלו בצורה חדה.",
      },
    ],
    sourceName: "MarketWatch",
    sourceUrl: "https://example.com/fixtures/markets",
  },
  bonds: {
    headline: "התשואה על אג״ח ממשלת ארה״ב לעשר שנים עלתה",
    summary:
      "מחיר האג״ח הארוכות ירד, ולכן התשואה עליהן עלתה. העלייה הגיעה אחרי נתונים שהראו שהכלכלה עדיין חזקה. אג״ח קצרות יותר זזו פחות.",
    marketMeaning: "תשואה גבוהה יותר על אג״ח ממשלתיות מייקרת את עלות הגיוס של ממשלות וחברות, ויכולה ללחוץ על מחירי מניות.",
    glossary: [
      {
        term: "yield",
        hebrew: "תשואה",
        explanation: "הריבית שמקבל מי שמחזיק באג״ח אם הוא מחזיק בה עד הסוף. כשמחיר האג״ח יורד, התשואה עולה.",
      },
    ],
    sourceName: "Google News — bonds",
    sourceUrl: "https://example.com/fixtures/bonds",
  },
  earnings: {
    headline: "ענקית טכנולוגיה עקפה את תחזית הרווח והזהירה מהוצאות גבוהות",
    summary:
      "החברה דיווחה על רווח גבוה מהתחזית ברבעון האחרון. במקביל היא אמרה שתוציא יותר על תשתיות בשנה הקרובה. המניה זזה חזק אחרי הסגירה.",
    marketMeaning: "דוח כזה יכול למשוך את כל סקטור הטכנולוגיה, כי משקיעים מעדכנים לפיו את הציפיות גם מחברות דומות.",
    glossary: [
      {
        term: "EPS",
        hebrew: "רווח למניה",
        explanation: "הרווח של החברה מחולק במספר המניות. כך משווים בין חברות בגדלים שונים.",
      },
    ],
    sourceName: "CNBC Earnings",
    sourceUrl: "https://example.com/fixtures/earnings",
  },
  "central-banks": {
    headline: "הפד הוריד את הריבית ברבע נקודת אחוז",
    summary:
      "הבנק המרכזי של ארה״ב הוריד את הריבית ברבע נקודת אחוז. ההחלטה התקבלה אחרי שהאינפלציה התמתנה. זו הפעם השנייה השנה שהריבית יורדת.",
    marketMeaning:
      "הורדת ריבית כזו מוזילה בדרך כלל הלוואות חדשות, ויכולה לתמוך במניות ובאג״ח, או להחליש את הדולר אם השוק קורא בה סימן לחולשה.",
    glossary: [
      {
        term: "rate cut",
        hebrew: "הורדת ריבית",
        explanation: "הבנק המרכזי מוזיל את מחיר הכסף כדי לעודד פעילות בכלכלה.",
      },
    ],
    sourceName: "Federal Reserve",
    sourceUrl: "https://example.com/fixtures/fed",
  },
  macro: {
    headline: "מדד המחירים לצרכן עלה פחות מהצפוי",
    summary:
      "מדד המחירים לצרכן בארה״ב עלה בקצב איטי יותר ממה שהכלכלנים צפו. גם המדד בלי מזון ואנרגיה התקרר. שוק העבודה לא השתנה בהודעה הזו.",
    marketMeaning:
      "הפתעה כלפי מטה במדד כזה בדרך כלל מורידה ציפיות להעלאת ריבית, ולכן אג״ח ומניות יכולות לעלות מיד אחרי הפרסום.",
    glossary: [
      {
        term: "CPI",
        hebrew: "מדד המחירים לצרכן",
        explanation: "מדד שמראה בכמה התייקרו הקניות של משק בית רגיל.",
      },
      {
        term: "jobs report",
        hebrew: "דוח תעסוקה",
        explanation: "הפרסום החודשי שמראה כמה משרות נוספו וכמה אנשים מחפשים עבודה.",
      },
    ],
    sourceName: "CNBC Economy",
    sourceUrl: "https://example.com/fixtures/macro",
  },
  commodities: {
    headline: "מחיר הנפט עלה בגלל חשש משיבוש באספקה",
    summary:
      "מחיר חבית נפט גולמי עלה אחרי דיווחים על שיבוש אפשרי בהובלה. גם מחירי הגז זזו באותו כיוון. הזהב נשאר יציב יחסית באותו יום.",
    marketMeaning: "נפט יקר יותר יכול להעלות עלויות של חברות תעופה ותחבורה, ולפעמים גם את ציפיות האינפלציה.",
    glossary: [
      {
        term: "barrel",
        hebrew: "חבית",
        explanation: "יחידת המדידה המקובלת לנפט גולמי בשוק העולמי.",
      },
    ],
    sourceName: "CNBC Energy",
    sourceUrl: "https://example.com/fixtures/commodities",
  },
  forex: {
    headline: "השקל נחלש מול הדולר והאירו",
    summary:
      "הדולר והאירו התחזקו מול השקל במסחר היום. התנועה הגיעה בלי החלטת ריבית חדשה בישראל. מטבעות אחרים של שווקים קטנים זזו בצורה מתונה.",
    marketMeaning: "שקל חלש יותר מייקר יבוא ומחירי נסיעות לחו״ל, ויכול לתמוך בחברות ישראליות שמוכרות בדולרים.",
    glossary: [
      {
        term: "exchange rate",
        hebrew: "שער חליפין",
        explanation: "כמה יחידות ממטבע אחד צריך כדי לקנות מטבע אחר, למשל כמה שקלים שווים דולר אחד.",
      },
    ],
    sourceName: "Google News — currencies",
    sourceUrl: "https://example.com/fixtures/forex",
  },
  israel: {
    headline: "בנק ישראל השאיר את הריבית ללא שינוי",
    summary:
      "בנק ישראל החליט לא לשנות את הריבית. הנגיד אמר שהאינפלציה עדיין מעל היעד. מדד תל אביב 35 נע סביב ההודעה בלי כיוון חד.",
    marketMeaning:
      "ריבית ללא שינוי משאירה את עלות המשכנתאות והאשראי העסקי קרובה לרמה הנוכחית, והשוק יחפש רמזים להחלטה הבאה.",
    glossary: [
      {
        term: "policy rate",
        hebrew: "ריבית בנק ישראל",
        explanation: "הריבית שבה הבנק המרכזי מלווה כסף לבנקים. היא משפיעה על פיקדונות, משכנתאות והלוואות.",
      },
    ],
    sourceName: "Globes",
    sourceUrl: "https://example.com/fixtures/israel",
  },
  ipo: {
    headline: "חברת תוכנה הגישה תשקיף לקראת הנפקה",
    summary:
      "החברה הגישה מסמכים כדי למכור מניות לציבור בפעם הראשונה. עוד לא נקבע המחיר הסופי ולא התאריך. בתשקיף היא תיארה הפסד בשנה האחרונה.",
    marketMeaning:
      "הנפקה גדולה יכולה למשוך כסף ממניות אחרות באותו סקטור ביום המסחר הראשון, כי קונים מפנים מזומן לעסקה החדשה.",
    glossary: [
      {
        term: "IPO",
        hebrew: "הנפקה ראשונית",
        explanation: "הפעם הראשונה שחברה מוכרת מניות לציבור והמניה מתחילה להיסחר בבורסה.",
      },
    ],
    sourceName: "Google News — IPOs",
    sourceUrl: "https://example.com/fixtures/ipo",
  },
  ma: {
    headline: "ענקית תרופות תרכוש מתחרה קטנה יותר",
    summary:
      "החברה הודיעה שתרכוש חברה אחרת בעסקה של כמה מיליארדי דולרים. העסקה עוד צריכה אישור של רגולטורים. מניית החברה הנרכשת עלתה, ומניית הרוכשת ירדה מעט.",
    marketMeaning:
      "בעסקאות כאלה המניה הנרכשת בדרך כלל מתקרבת למחיר שהוצע, והרוכשת זזה לפי החשש מתשלום גבוה מדי או מחיסכון עתידי בעלויות.",
    glossary: [
      {
        term: "M&A",
        hebrew: "מיזוג ורכישה",
        explanation: "עסקה שבה חברה קונה חברה אחרת, או ששתי חברות מתאחדות לחברה אחת.",
      },
    ],
    sourceName: "Google News — M&A",
    sourceUrl: "https://example.com/fixtures/ma",
  },
  regulation: {
    headline: "רשות ניירות ערך בארה״ב פתחה בבדיקה של קרן גדולה",
    summary:
      "הרשות הודיעה שפתחה בבדיקה של דיווחים לציבור בקרן השקעות גדולה. לא הוגש כתב אישום. החברה אמרה שהיא משתפת פעולה.",
    marketMeaning:
      "בדיקה כזו יכולה ללחוץ על מניית החברה ועל קרנות דומות, כל עוד לא ברור אם יהיה קנס או רק דרישה לתיקון דיווחים.",
    glossary: [
      {
        term: "SEC",
        hebrew: "הרשות לניירות ערך",
        explanation: "הגוף בארה״ב שמפקח על הבורסות ועל המידע שחברות חייבות לפרסם למשקיעים.",
      },
    ],
    sourceName: "SEC",
    sourceUrl: "https://example.com/fixtures/regulation",
  },
  housing: {
    headline: "מכירות הבתים בארה״ב הואטו כשריבית המשכנתא נשארה גבוהה",
    summary:
      "מספר הבתים שנמכרו ירד לעומת החודש הקודם. ריבית המשכנתא ל-30 שנה כמעט לא זזה. מלאי הבתים למכירה עלה מעט.",
    marketMeaning: "שוק דיור איטי יותר יכול לקרר הוצאות של משקי בית ואת הביקוש למוצרי בית, ולהשפיע על הציפיות להורדת ריבית.",
    glossary: [
      {
        term: "mortgage rate",
        hebrew: "ריבית משכנתא",
        explanation: "הריבית על הלוואה לקניית דירה. כשהיא גבוהה, ההחזר החודשי יקר יותר ופחות קונים נכנסים לשוק.",
      },
    ],
    sourceName: "CNBC Real Estate",
    sourceUrl: "https://example.com/fixtures/housing",
  },
  geopolitics: {
    headline: "איום במכסים חדשים טלטל מניות של יצואנים",
    summary:
      "איום להטיל מכסים על יבוא ממדינה גדולה הוריד מניות של חברות שמוכרות לשם. גם מטבע של אותה מדינה נחלש. עדיין לא נחתם צו רשמי.",
    marketMeaning: "מכס חדש יכול לייקר מוצרים, לחתוך רווחים של יצואנים, ולהזיז גם סחורות ומטבעות שקשורים לאותו נתיב סחר.",
    glossary: [
      {
        term: "tariff",
        hebrew: "מכס",
        explanation: "מס שמדינה גובה על סחורה שחוצה את הגבול. הוא יכול לייקר את המוצר לצרכן או לפגוע ברווח של היבואן.",
      },
    ],
    sourceName: "Google News — trade and tariffs",
    sourceUrl: "https://example.com/fixtures/geopolitics",
  },
  tech: {
    headline: "הוצאות הענק על בינה מלאכותית מטלטלות את מניות השבבים",
    summary:
      "כמה חברות טכנולוגיה גדולות אמרו שיגדילו השקעה בחוות שרתים ובשבבים. מניות יצרני השבבים עלו, וחלק מספקיות הענן ירדו בגלל חשש מההוצאה. לא פורסם שינוי במחיר המוצרים לצרכן.",
    marketMeaning: "כשחברות הענק משנות את תקציב הבינה המלאכותית, כל שרשרת השבבים, החשמל והענן יכולה לזוז יחד.",
    glossary: [
      {
        term: "capex",
        hebrew: "הוצאות הון",
        explanation: "כסף שחברה מוציאה על ציוד ומבנים לשנים קדימה, למשל שרתים, ולא על הוצאה שוטפת כמו משכורות.",
      },
    ],
    sourceName: "CNBC Tech",
    sourceUrl: "https://example.com/fixtures/tech",
  },
  banks: {
    headline: "בנק גדול הרוויח ממסחר והזהיר מהפסדי אשראי",
    summary:
      "הבנק דיווח על רווח גבוה מהמסחר במניות ובאג״ח, בין השאר מול קרנות גידור. במקביל הוא הגדיל את הרזרבה להפסדי אשראי. המניה נעה בשני הכיוונים במהלך היום.",
    marketMeaning:
      "רווח ממסחר יכול לחזק את מניות הבנקים בטווח הקצר, אבל רזרבה גבוהה יותר להפסדים מאותתת שהבנק רואה יותר סיכון אצל לווים.",
    glossary: [
      {
        term: "hedge fund",
        hebrew: "קרן גידור",
        explanation: "קרן שמנהלת כסף של לקוחות עשירים ומנסה להרוויח גם כשהשוק יורד, לפעמים בעזרת הלוואות.",
      },
    ],
    sourceName: "Google News — banks and fintech",
    sourceUrl: "https://example.com/fixtures/banks",
  },
};

export interface RenderedSample {
  categoryId: string;
  text: string;
}

export function renderSamples(): RenderedSample[] {
  return DEFAULT_CATEGORIES.map((category) => {
    const draft = DRAFTS[category.id];
    if (!draft) throw new Error(`missing sample for ${category.id}`);
    return {
      categoryId: category.id,
      text: formatTelegramMessage({
        category,
        ...draft,
        disclaimer: DEFAULT_DISCLAIMER,
      }),
    };
  });
}
