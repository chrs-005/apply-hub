/* Shared by the options page and the content script:
 *   AH_FIELDS  : the profile you fill in once (options page)
 *   AH_RULES   : how a form field's label maps to a profile value
 */
var AH_FIELDS = [
  { section: "Personal" },
  { key: "first_name", label: "First name" },
  { key: "last_name", label: "Last name" },
  { key: "preferred_name", label: "Preferred name", hint: "Leave empty if same as first name" },
  { key: "email", label: "Email", type: "email" },
  { key: "phone_code", label: "Phone country code", placeholder: "+961" },
  { key: "phone_country", label: "Phone country (for dropdowns)", placeholder: "Lebanon" },
  { key: "phone", label: "Phone (without country code)", placeholder: "71 123 456" },
  { key: "address", label: "Street address" },
  { key: "city", label: "City", placeholder: "Beirut" },
  { key: "postal_code", label: "Postal code" },
  { key: "country", label: "Country of residence", placeholder: "Lebanon" },
  { key: "nationality", label: "Nationality / citizenship", placeholder: "Lebanese" },
  { key: "dob", label: "Date of birth", type: "date" },
  { key: "pronouns", label: "Pronouns (optional)" },

  { section: "Links" },
  { key: "linkedin", label: "LinkedIn URL", type: "url" },
  { key: "github", label: "GitHub URL", type: "url" },
  { key: "website", label: "Website / portfolio", type: "url" },
  { key: "scholar", label: "Google Scholar (optional)", type: "url" },

  { section: "Education" },
  { key: "university", label: "University", placeholder: "e.g. American University of Beirut" },
  { key: "degree", label: "Degree", placeholder: "Bachelor of Engineering (BE)" },
  { key: "degree_level", label: "Degree level (for dropdowns)", placeholder: "Bachelor's" },
  { key: "major", label: "Major(s)", placeholder: "Computer & Communications Engineering; Mathematics" },
  { key: "gpa", label: "GPA", placeholder: "3.9" },
  { key: "gpa_scale", label: "GPA scale", placeholder: "4.0" },
  { key: "edu_start", label: "Studies start (YYYY-MM)", placeholder: "2023-09" },
  { key: "grad_date", label: "Graduation date for INTERNSHIP applications (YYYY-MM)", placeholder: "2028-06" },
  { key: "grad_date_grad", label: "Graduation date for GRAD SCHOOL applications (YYYY-MM)", placeholder: "2027-06", hint: "Used on university portals" },

  { section: "Availability & eligibility" },
  { key: "earliest_start", label: "Earliest internship start", type: "date" },
  { key: "latest_end", label: "Latest internship end", type: "date" },
  { key: "duration", label: "Internship duration", placeholder: "10–12 weeks" },
  { key: "needs_sponsorship", label: "Will you need visa sponsorship?", type: "select", options: ["Yes", "No"] },
  { key: "auth_eu", label: "Authorised to work in the EU?", type: "select", options: ["No", "Yes"] },
  { key: "auth_uk", label: "Authorised to work in the UK?", type: "select", options: ["No", "Yes"] },
  { key: "auth_ch", label: "Authorised to work in Switzerland?", type: "select", options: ["No", "Yes"] },
  { key: "auth_gulf", label: "Authorised to work in the Gulf?", type: "select", options: ["No", "Yes"] },
  { key: "auth_default", label: "Authorised to work (any other country)?", type: "select", options: ["No", "Yes"] },
  { key: "relocate", label: "Willing to relocate?", type: "select", options: ["Yes", "No"] },
  { key: "languages", label: "Languages", placeholder: "Arabic (native), English (fluent), French (fluent)" },
  { key: "hear_about", label: "How did you hear about us? (default)", placeholder: "Company website" },
  { key: "salary", label: "Salary expectation (default)", placeholder: "Open / per company standard" },

  { section: "Voluntary questions (EEO)" },
  { key: "gender", label: "Gender answer", placeholder: "Prefer not to say" },
  { key: "eeo_decline", label: "Race / ethnicity answer", placeholder: "Prefer not to say" },
  { key: "veteran", label: "Veteran status answer", placeholder: "I am not a protected veteran" },
  { key: "disability", label: "Disability answer", placeholder: "I do not wish to answer" },
];

/* Rules are tried in order on a field's label text (lower-case). First match wins.
 * value(p, ctx) returns what to put in the field. */
var AH_RULES = [
  { key: "linkedin", re: /linked\s?in/ },
  { key: "github", re: /git\s?hub/ },
  { key: "scholar", re: /google scholar/ },
  { key: "website", re: /website|portfolio|personal (site|url|page)|homepage|blog\b|other (url|link)/ },
  { key: "email", re: /e-?mail|courriel/ },
  { key: "phone_code", re: /(country|dial(ing)?|phone|area) ?code|indicatif|phone country/, value: (p, c) => c.isSelect ? (p.phone_country || p.phone_code) : p.phone_code },
  { key: "phone", re: /phone|mobile|cell|t[ée]l[ée]phone|telefon|handy/, value: (p, c) => c.wantsFullPhone ? `${p.phone_code || ""} ${p.phone || ""}`.trim() : p.phone },
  { key: "preferred_name", re: /preferred (first )?name|nick ?name|known as/, value: (p) => p.preferred_name || p.first_name },
  { key: "first_name", re: /first ?name|given ?name|fore ?name|pr[ée]nom|vorname/ },
  { key: "last_name", re: /last ?name|sur ?name|family ?name|nom de famille|nachname|^nom\b/ },
  { key: "full_name", re: /full ?name|^\W*name\W*\*?$|your name|legal name|candidate name|nom complet|^name \*?$/, not: /company|school|university|employer|reference|referr|emergency|manager|recruiter/, value: (p) => `${p.first_name || ""} ${p.last_name || ""}`.trim() },
  { key: "location", re: /current location|^\W*location\W*\*?$|where are you (currently )?(based|located)|city,? (and|&)? ?country/, value: (p) => [p.city, p.country].filter(Boolean).join(", ") },
  { key: "postal_code", re: /zip|postal|post ?code|code postal|\bplz\b/ },
  { key: "address", re: /address( ?line)? ?1|street|adresse|^\W*address\W*\*?$/, not: /e-?mail|ip address/ },
  { key: "city", re: /\bcity\b|town|ville|\bstadt\b|\bort\b/ },
  { key: "nationality", re: /nationalit|citizenship|citizen of/ },
  { key: "country", re: /\bcountry\b|\bpays\b|\bland\b/, not: /phone|code|citizen|nationalit|work in|authori/ },
  { key: "dob", re: /birth|\bdob\b|date de naissance|geburtsdatum/ },
  { key: "university", re: /school|universit|college|institution|[ée]cole|hochschule|academic institution/, not: /high ?school|graduat(e|ion) (date|year)/ },
  { key: "degree", re: /degree|diploma|qualification|dipl[ôo]me|abschluss|level of (study|education)/, not: /year|date|gpa|grade/, value: (p, c) => c.isSelect ? (p.degree_level || p.degree) : p.degree },
  { key: "major", re: /major|discipline|field of stud|area of stud|specializ|specialis|concentration|fili[èe]re|studiengang|programme of study|course of study/ },
  { key: "gpa_scale", re: /maximum (grade|gpa|mark|score)|grading scale|grade scale|gpa scale|scale (of|for) (the )?(grade|gpa)|out of\b|best (possible )?grade|note maximale|bestnote/ },
  { key: "gpa", re: /\bgpa\b|grade point|\bcgpa\b|average grade|cumulative (average|grade|result)|grades? ?\/ ?results|moyenne|notendurchschnitt/, value: (p, c) => c.wantsScale ? `${p.gpa}/${p.gpa_scale}` : p.gpa },
  { key: "grad_date", re: /graduat|completion date|date of completion|expected (date|end|finish|completion)|attended (until|to)\b|(date|year) (of )?degree (conferred|awarded|expected)|degree (conferred|awarded)|conferr|end date of (your )?(stud|degree)|date d'obtention|abschlussdatum/, value: (p, c) => dateFor(c.gradSchool ? (p.grad_date_grad || p.grad_date) : p.grad_date, c) },
  { key: "edu_start", re: /attended from|(dates? )?attended:? from|from date|start(ed)? (date )?of (your )?(stud|degree|attendance)|enrol(l)?ment date|date (you )?started|date of (entry|enrol(l)?ment)/, value: (p, c) => dateFor(p.edu_start, c) },
  { key: "earliest_start", re: /start date|available (from|to start)|earliest start|availability|when (can|could) you start|date de d[ée]but|eintrittsdatum|starting date/, value: (p, c) => dateFor(p.earliest_start, c) },
  { key: "latest_end", re: /end date|available until|date de fin/, value: (p, c) => dateFor(p.latest_end, c) },
  { key: "duration", re: /duration|how long|dur[ée]e|length of (the )?internship/ },
  { key: "needs_sponsorship", re: /sponsor|visa/ },
  { key: "work_auth", re: /authori[sz]ed to work|right to work|eligible to work|legally (allowed|permitted|able|entitled)|work permit|permission to work|work authori/, value: (p, c) => {
      const t = c.text;
      if (/united kingdom|\buk\b|britain/.test(t)) return p.auth_uk;
      if (/switzerland|swiss/.test(t)) return p.auth_ch;
      if (/\beu\b|europe|eea|netherlands|france|germany|ireland|spain|ital|poland|denmark|sweden|belgium/.test(t)) return p.auth_eu;
      if (/uae|emirates|saudi|qatar|dubai|abu dhabi|gulf|bahrain|kuwait/.test(t)) return p.auth_gulf;
      return p.auth_default;
    } },
  { key: "relocate", re: /relocat/ },
  { key: "hear_about", re: /how did you (hear|find|learn)|where did you (hear|see|find|learn)|^\W*source\W*\*?$|how did you come across/ },
  { key: "salary", re: /salary|compensation|pay expectation|r[ée]mun[ée]ration|gehalt/ },
  { key: "languages", re: /which languages|languages? (spoken|you speak)|^\W*languages?\W*\*?$|language skills/ },
  { key: "pronouns", re: /pronoun/ },
  { key: "veteran", re: /veteran/ },
  { key: "disability", re: /disabilit/ },
  { key: "gender", re: /gender|\bsex\b|genre/ },
  { key: "eeo_decline", re: /\brace\b|ethnic|hispanic|latino|sexual orientation|lgbt|transgender/ },
];

function dateFor(v, c) {
  // v is "YYYY-MM" or "YYYY-MM-DD"; adapt to what the field looks like
  if (!v) return "";
  const [y, m, d] = String(v).split("-");
  if (c.inputType === "date") return `${y}-${m || "01"}-${d || "01"}`;
  if (c.inputType === "month") return `${y}-${m || "01"}`;
  if (/\byear\b|ann[ée]e|jahr/.test(c.text) && !/month/.test(c.text)) return y;
  if (/\bmonth\b|mois|monat/.test(c.text) && !/year/.test(c.text)) return c.isSelect ? MONTHS[(+m || 1) - 1] : m;
  if (/mm\/yyyy|mm\/yy/.test(c.text + " " + c.placeholder)) return `${m}/${y}`;
  if (/dd\/mm\/yyyy/.test(c.text + " " + c.placeholder)) return `${d || "01"}/${m}/${y}`;
  if (/mm\/dd\/yyyy/.test(c.text + " " + c.placeholder)) return `${m}/${d || "01"}/${y}`;
  return d ? `${d}/${m}/${y}` : `${MONTHS[(+m || 1) - 1]} ${y}`;
}
var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
