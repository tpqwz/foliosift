import { chunkWork } from "./markup.ts";
import { SAMPLE_STAMPS } from "./sample-stamps.ts";
import type { CatalogIds, Section, Work } from "./types";

const COVERS: Record<string, string> = {
  iliad: "/covers/iliad.jpg",
  odyssey: "/covers/odyssey.jpg",
  "works-and-days": "/covers/works-and-days.jpg",
  peloponnesian: "/covers/peloponnesian.jpg",
  republic: "/covers/republic.jpg",
  apology: "/covers/apology.jpg",
  ethics: "/covers/ethics.jpg",
  aeneid: "/covers/aeneid.jpg",
  meditations: "/covers/meditations.jpg",
  enchiridion: "/covers/enchiridion.jpg",
  rerum: "/covers/rerum.jpg",
};

const DATES: Record<string, string> = {
  iliad: "c. 8th century BCE",
  odyssey: "c. 8th century BCE",
  "works-and-days": "c. 700 BCE",
  "golden-verses": "attributed, ancient",
  peloponnesian: "c. 400 BCE",
  apology: "c. 399 BCE",
  republic: "c. 375 BCE",
  ethics: "c. 340 BCE",
  aeneid: "19 BCE",
  meditations: "c. 170 CE",
  enchiridion: "c. 125 CE",
  rerum: "c. 55 BCE",
  confessions: "397–400",
  "city-of-god": "413–426",
  guide: "c. 1190",
  compendium: "c. 1000",
  averroes: "c. 1179",
  "critique": "1781",
  groundwork: "1785",
  prolegomena: "1783",
  "perpetual-peace": "1795",
  "hegel-logic": "1817",
  federalist: "1787–1788",
  "freud-dreams": "1913",
  "freud-everyday": "1914",
  "freud-totem": "1918",
  "freud-sex": "1910",
  "freud-wit": "1916",
  "jung-unconscious": "1916",
  kierkegaard: "1923",
  "durant-problem": "1917",
  novanglus: "1774–1775",
  "common-sense": "1776",
  "age-of-reason": "1794–1796",
  franklin: "1791",
  "lincoln-speeches": "1832–1865",
  didache: "1st–2nd century",
  "niebuhr-leaves": "1929",
  "niebuhr-religion": "1927",
  farewell: "1796",
  "virginia-declaration": "1776",
  eudemian: "c. 340 BCE",
  laws: "c. 350 BCE",
  politics: "c. 330 BCE",
  "politics-gr": "c. 330 BCE",
  cannon: "1915",
  "essay-on-criticism": "1717",
};

const WORK_IDS: Record<string, CatalogIds> = {
  iliad: { wikidata: "Q8275", openlibrary: "OL34610657W" },
  odyssey: { wikidata: "Q35160", openlibrary: "OL61982W" },
  "works-and-days": { wikidata: "Q667285", openlibrary: "OL602616W" },
  peloponnesian: { wikidata: "Q639493" },
  apology: { wikidata: "Q273668", openlibrary: "OL51948W" },
  republic: { wikidata: "Q123397", openlibrary: "OL51831W" },
  ethics: { wikidata: "Q474537", openlibrary: "OL8273964W" },
  politics: { wikidata: "Q69539" },
  "politics-gr": { wikidata: "Q69539" },
  aeneid: { wikidata: "Q60220", openlibrary: "OL17405200W" },
  meditations: { wikidata: "Q1152283", openlibrary: "OL1317211W" },
  enchiridion: { wikidata: "Q2137133", openlibrary: "OL16233356W" },
  rerum: { wikidata: "Q861986", openlibrary: "OL1548597W" },
  confessions: { wikidata: "Q372941" },
  "city-of-god": { wikidata: "Q212318" },
  guide: { wikidata: "Q1140185" },
  compendium: { lccn: "06039840" },
  "golden-verses": { wikidata: "Q1046042" },
  averroes: { wikidata: "Q28222009" },
  prolegomena: { wikidata: "Q1761342" },
  critique: { wikidata: "Q220002" },
  groundwork: { wikidata: "Q1550565" },
  "perpetual-peace": { wikidata: "Q229583" },
  "hegel-logic": { openlibrary: "OL24380768W" },
  cannon: { lccn: "15009718" },
  "essay-on-criticism": { wikidata: "Q482427" },
};

/** Free in the United States, and still restricted where the term is the author's life plus seventy years. */
const UNITED_STATES: Record<string, true> = {
  "jung-unconscious": true,
  kierkegaard: true,
  "durant-problem": true,
  "niebuhr-leaves": true,
  "niebuhr-religion": true,
  eudemian: true,
};

function w(
  id: string,
  title: string,
  author: string,
  language: string,
  form: string,
  period: string,
  genre: string,
  edition: string,
  description: string,
): Work {
  return {
    id,
    title,
    author,
    language,
    form,
    period,
    genre,
    edition,
    description,
    rights: UNITED_STATES[id] ? "Public domain in the United States." : "Public domain.",
    date: DATES[id],
    ids: WORK_IDS[id],
    ...(COVERS[id] ? { cover: COVERS[id] } : {}),
    sections: [],
  };
}


/**
 * Full public-domain translations. The prose is fetched from /samples, not
 * bundled here, so the shelf stays a catalog.
 */
export const WORKS: Work[] = [
  w(
    "iliad",
    "Iliad",
    "Homer",
    "English",
    "Verse",
    "Archaic",
    "Epic",
    "Translated by Samuel Butler, 1898",
    "The quarrel between Agamemnon and Achilles, and the wrath that follows it to the funeral of Hector.",
  ),
  w(
    "odyssey",
    "Odyssey",
    "Homer",
    "English",
    "Verse",
    "Archaic",
    "Epic",
    "Translated by Samuel Butler, 1900",
    "Tell me, O Muse, of that ingenious hero who travelled far and wide after he had sacked the famous town of Troy.",
  ),
  w(
    "works-and-days",
    "Works and Days",
    "Hesiod",
    "English",
    "Verse",
    "Archaic",
    "Didactic",
    "Translated by Hugh G. Evelyn-White, 1914",
    "Muses of Pieria who give glory through song, come hither, tell of Zeus your father and chant his praise.",
  ),
  w(
    "golden-verses",
    "The Golden Verses",
    "Pythagoras",
    "English",
    "Verse",
    "Archaic",
    "Philosophy",
    "Translated, with commentary, by Antoine Fabre d’Olivet",
    "The verses attributed to Pythagoras, together with Fabre d’Olivet’s commentary. No book by Pythagoras himself survives.",
  ),
  w(
    "peloponnesian",
    "History of the Peloponnesian War",
    "Thucydides",
    "English",
    "Prose",
    "Classical",
    "History",
    "Translated by Richard Crawley, 1874",
    "Thucydides, an Athenian, wrote the history of the war between the Peloponnesians and the Athenians.",
  ),
  w(
    "apology",
    "Apology",
    "Plato",
    "English",
    "Prose",
    "Classical",
    "Philosophy",
    "Translated by Benjamin Jowett",
    "How you, O Athenians, have been affected by my accusers, I cannot tell; but I know that they almost made me forget who I was.",
  ),
  w(
    "republic",
    "Republic",
    "Plato",
    "English",
    "Prose",
    "Classical",
    "Philosophy",
    "Translated by Benjamin Jowett",
    "I went down yesterday to the Piraeus with Glaucon the son of Ariston, that I might offer up my prayers to the goddess.",
  ),
  w(
    "ethics",
    "Nicomachean Ethics",
    "Aristotle",
    "English",
    "Prose",
    "Classical",
    "Philosophy",
    "Translated by D. P. Chase, 1861",
    "Every art, and every science reduced to a teachable form, and in like manner every action and moral choice, aims at some good.",
  ),
  w(
    "aeneid",
    "Aeneid",
    "Virgil",
    "English",
    "Verse",
    "Roman",
    "Epic",
    "Translated by John Dryden, 1697",
    "Dryden’s Aeneid, from the storm that opens Book I to the death of Turnus.",
  ),
  w(
    "meditations",
    "Meditations",
    "Marcus Aurelius",
    "English",
    "Prose",
    "Imperial",
    "Philosophy",
    "Translated by George Long, 1862",
    "Of my grandfather Verus I have learned to be gentle and meek, and to refrain from all anger and passion.",
  ),
  w(
    "enchiridion",
    "Enchiridion",
    "Epictetus",
    "English",
    "Prose",
    "Imperial",
    "Philosophy",
    "Translated by George Long",
    "Of things some are in our power, and others are not. In our power are opinion, movement toward a thing, and desire.",
  ),
  w(
    "rerum",
    "On the Nature of Things",
    "Lucretius",
    "English",
    "Verse",
    "Roman",
    "Didactic",
    "Translated by William Ellery Leonard, 1916",
    "Mother of Rome, delight of Gods and men, dear Venus that beneath the gliding stars makest to teem the many-voyaged main.",
  ),
  w(
    "confessions",
    "Confessions",
    "Augustine",
    "English",
    "Prose",
    "Late antique",
    "Philosophy",
    "Translated by E. B. Pusey",
    "Great art Thou, O Lord, and greatly to be praised; great is Thy power, and Thy wisdom infinite.",
  ),
  w(
    "city-of-god",
    "City of God",
    "Augustine",
    "English",
    "Prose",
    "Late antique",
    "Philosophy",
    "Translated by Marcus Dods, 1871",
    "Augustine answers the pagans who blamed the sack of Rome on the Christian refusal of the old gods.",
  ),
  w(
    "guide",
    "The Guide for the Perplexed",
    "Maimonides",
    "English",
    "Prose",
    "Medieval",
    "Philosophy",
    "Translated by M. Friedländer, 1904",
    "A letter on how the Law and Aristotle’s account of the world can be read together, from the twenty-six propositions of the philosophers to prophecy.",
  ),
  w(
    "compendium",
    "A Compendium on the Soul",
    "Avicenna",
    "English",
    "Prose",
    "Medieval",
    "Philosophy",
    "Translated by Edward Abbott van Dyck",
    "The faculties of the soul, from the outer senses to the intellect, set out on the lines of Aristotle.",
  ),
  w(
    "averroes",
    "The Philosophy and Theology of Averroes",
    "Averroes",
    "English",
    "Prose",
    "Medieval",
    "Philosophy",
    "Translated by Mohammad Jamil-ur-Rehman",
    "The Decisive Treatise, on how philosophy and the Law stand toward each other, and the short theological essays that follow it.",
  ),
  w(
    "prolegomena",
    "Prolegomena to Any Future Metaphysics",
    "Immanuel Kant",
    "English",
    "Prose",
    "Modern",
    "Philosophy",
    "Translated by Paul Carus",
    "A shorter way into the Critique of Pure Reason: what metaphysics can be, if it is to be a science.",
  ),
  w(
    "critique",
    "Critique of Pure Reason",
    "Immanuel Kant",
    "English",
    "Prose",
    "Modern",
    "Philosophy",
    "Translated by J. M. D. Meiklejohn",
    "The limits of what can be known, from the prefaces of 1781 and 1787 through the history of pure reason.",
  ),
  w(
    "groundwork",
    "Fundamental Principles of the Metaphysic of Morals",
    "Immanuel Kant",
    "English",
    "Prose",
    "Modern",
    "Philosophy",
    "Translated by Thomas Kingsmill Abbott",
    "From ordinary moral knowledge to the categorical imperative.",
  ),
  w(
    "perpetual-peace",
    "Perpetual Peace",
    "Immanuel Kant",
    "English",
    "Prose",
    "Modern",
    "Philosophy",
    "Translated by Mary Campbell Smith",
    "A philosophical sketch of the articles on which a lasting peace between states would stand.",
  ),
  w(
    "hegel-logic",
    "The Logic of Hegel",
    "Hegel",
    "English",
    "Prose",
    "Modern",
    "Philosophy",
    "Translated by William Wallace",
    "The Logic of the Encyclopaedia, from being through essence to the notion.",
  ),
  w("federalist", "The Federalist Papers", "Alexander Hamilton; James Madison; John Jay", "English", "Prose", "Modern", "Politics", "The essays of Publius, 1787–1788", "The eighty-five papers arguing for the Constitution, from the insufficiency of the Confederation to the judicial department."),
  w("freud-dreams", "The Interpretation of Dreams", "Sigmund Freud", "English", "Prose", "Modern", "Psychology", "Translated by A. A. Brill, from the third edition", "The dream as a fulfillment, and the method of reading it."),
  w("freud-everyday", "Psychopathology of Everyday Life", "Sigmund Freud", "English", "Prose", "Modern", "Psychology", "Translated by A. A. Brill", "Forgetting, slips, and the other small errors that are not accidents."),
  w("freud-totem", "Totem and Taboo", "Sigmund Freud", "English", "Prose", "Modern", "Psychology", "Translated by A. A. Brill", "Incest dread, taboo, animism, and the return of totemism in childhood."),
  w("freud-sex", "Three Contributions to the Theory of Sex", "Sigmund Freud", "English", "Prose", "Modern", "Psychology", "Translated by A. A. Brill", "The sexual aberrations, infantile sexuality, and the transformations of puberty."),
  w("freud-wit", "Wit and Its Relation to the Unconscious", "Sigmund Freud", "English", "Prose", "Modern", "Psychology", "Translated by A. A. Brill", "How a joke does the work of a dream, in public and in less time."),
  w("jung-unconscious", "Psychology of the Unconscious", "C. G. Jung", "English", "Prose", "Modern", "Psychology", "Translated by Beatrice M. Hinkle, 1916", "The early study of the transformations and symbolisms of the libido."),
  w("kierkegaard", "Selections", "Søren Kierkegaard", "English", "Prose", "Modern", "Philosophy", "Translated by L. M. Hollander, 1923", "Hollander’s selection from the authorship, with his introduction."),
  w("durant-problem", "Philosophy and the Social Problem", "Will Durant", "English", "Prose", "Modern", "Philosophy", "New York, 1917", "From Socrates to the social problem, and what philosophy might still do about it."),
  w("novanglus", "Novanglus and Massachusettensis", "John Adams; Daniel Leonard", "English", "Prose", "Modern", "Politics", "The newspaper essays of 1774 and 1775", "Adams answering the loyalist Massachusettensis, with the essays he was answering."),
  w("common-sense", "Common Sense", "Thomas Paine", "English", "Prose", "Modern", "Politics", "Philadelphia, 1776", "Of government in general, of monarchy, and of the present ability of America."),
  w("age-of-reason", "The Age of Reason", "Thomas Paine", "English", "Prose", "Modern", "Religion", "1794–1796", "The profession of faith, and the examination of the Old and New Testaments."),
  w("franklin", "Autobiography", "Benjamin Franklin", "English", "Prose", "Modern", "History", "The memoirs, first published in French in 1791", "From the candle-maker’s son to the public business of Philadelphia and London."),
  w("lincoln-speeches", "Speeches and Letters", "Abraham Lincoln", "English", "Prose", "Modern", "Politics", "Edited by Merwin Roe, 1907", "From the early letters through the debates to the second inaugural."),
  w("didache", "The Teaching of the Twelve Apostles", "Anonymous", "English", "Prose", "Classical", "Religion", "English of Hitchcock and Brown, 1884", "The two ways, the rites, and the order of the earliest church manual."),
  w("niebuhr-leaves", "Leaves from the Notebook of a Tamed Cynic", "Reinhold Niebuhr", "English", "Prose", "Modern", "Religion", "Willett, Clark and Colby, 1929", "A young minister’s notes on the church, the city, and his own temper."),
  w("niebuhr-religion", "Does Civilization Need Religion?", "Reinhold Niebuhr", "English", "Prose", "Modern", "Religion", "New York, 1927", "What religion can and cannot do for a civilization that no longer believes it."),
  w("farewell", "Farewell Address", "George Washington", "English", "Prose", "Modern", "Politics", "1796", "Friends and fellow-citizens: the resolution to leave the presidency, and the warning that went with it."),
  w("virginia-declaration", "Virginia Declaration of Rights", "George Mason", "English", "Prose", "Modern", "Politics", "12 June 1776", "The rights that pertain to the people of Virginia, and their posterity."),
  w("eudemian", "Eudemian Ethics", "Aristotle", "English", "Prose", "Classical", "Philosophy", "Books I–III and VII, with the fragmentary Book VIII. Translated by J. Solomon, 1915", "Happiness is at once the most beautiful and the best of things, and also the pleasantest. Books IV–VI are the books in common with the Nicomachean Ethics."),
  w("laws", "Laws", "Plato", "English", "Prose", "Classical", "Philosophy", "Translated by Benjamin Jowett", "An Athenian, a Cretan, and a Spartan, walking from Cnosus to the cave and temple of Zeus, devise the laws of a city."),
  w("politics", "Politics", "Aristotle", "English", "Prose", "Classical", "Politics", "Translated by William Ellis. Everyman edition, 1912, with A. D. Lindsay’s introduction", "Every city is a society, and every society is established for some good purpose. The eight books, from the household to the education of the young."),
  w("politics-gr", "Politics", "Aristotle", "Greek", "Prose", "Classical", "Politics", "Greek text", "The eight books in Greek, from the household to the three bounds of education."),
  w("cannon", "Bodily Changes in Pain, Hunger, Fear and Rage", "Walter B. Cannon", "English", "Prose", "Modern", "Psychology", "New York, D. Appleton and Company, 1915", "How pain, hunger, fear, and rage change the body: digestion checked, sugar freed, and adrenin poured out for fight or flight."),
  w("essay-on-criticism", "An Essay on Criticism", "Alexander Pope", "English", "Verse", "Modern", "Didactic", "The Works of Alexander Pope, 1717", "’Tis hard to say, if greater want of skill appear in writing or in judging ill. Written in 1709, and printed here from the Works of 1717."),
];

export function authorSortKey(author: string): string {
  const parts = author.split(" ");
  return parts[parts.length - 1] ?? author;
}

export function isSample(id: string): boolean {
  return WORKS.some((work) => work.id === id);
}

export function sampleStamp(id: string): string {
  return SAMPLE_STAMPS[id] ?? "";
}

const sampleText = new Map<string, Promise<Work | null>>();

/** The shipped translation for a catalog id. Cached for the life of the page. */
export function loadSampleText(id: string): Promise<Work | null> {
  const meta = WORKS.find((work) => work.id === id);
  if (!meta) return Promise.resolve(null);
  const pending = sampleText.get(id);
  if (pending) return pending;
  const next = fetchSample(meta);
  sampleText.set(id, next);
  return next;
}

async function fetchSample(meta: Work): Promise<Work | null> {
  try {
    const response = await fetch(`/samples/${meta.id}.json`);
    if (!response.ok) return null;
    const data = (await response.json()) as { sections?: { heading?: string; text?: string }[] };
    const sections: Section[] = [];
    for (const [index, section] of (data.sections ?? []).entries()) {
      const text = section.text ?? "";
      if (!text.trim()) continue;
      sections.push({
        id: `${meta.id}-${sections.length + 1}`,
        heading: section.heading?.trim() || `Section ${index + 1}`,
        text,
      });
    }
    if (!sections.length) return null;
    return chunkWork({ ...meta, sections });
  } catch {
    return null;
  }
}
