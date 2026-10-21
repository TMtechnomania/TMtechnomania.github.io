// Local quote pack.
//
// No network, no account, no tracking: the daily quote is picked from this
// bundled list with a stable hash of the local date. Everyone sees a new quote
// at local midnight, and the same quote for the whole day.

export const QUOTES = [
	{ text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
	{ text: "Simplicity is the ultimate sophistication.", author: "Leonardo da Vinci" },
	{ text: "Well done is better than well said.", author: "Benjamin Franklin" },
	{ text: "The journey of a thousand miles begins with one step.", author: "Lao Tzu" },
	{ text: "Whether you think you can or you think you can't, you're right.", author: "Henry Ford" },
	{ text: "It always seems impossible until it's done.", author: "Nelson Mandela" },
	{ text: "Do what you can, with what you have, where you are.", author: "Theodore Roosevelt" },
	{ text: "The best way to predict the future is to invent it.", author: "Alan Kay" },
	{ text: "Small deeds done are better than great deeds planned.", author: "Peter Marshall" },
	{ text: "Action is the foundational key to all success.", author: "Pablo Picasso" },
	{ text: "Quality is not an act, it is a habit.", author: "Aristotle" },
	{ text: "Fall seven times, stand up eight.", author: "Japanese proverb" },
	{ text: "A ship in harbor is safe, but that is not what ships are built for.", author: "John A. Shedd" },
	{ text: "What we think, we become.", author: "Buddha" },
	{ text: "Happiness depends upon ourselves.", author: "Aristotle" },
	{ text: "No act of kindness, no matter how small, is ever wasted.", author: "Aesop" },
	{ text: "He who has a why to live can bear almost any how.", author: "Friedrich Nietzsche" },
	{ text: "Life is what happens when you're busy making other plans.", author: "John Lennon" },
	{ text: "The future belongs to those who believe in the beauty of their dreams.", author: "Eleanor Roosevelt" },
	{ text: "Not all those who wander are lost.", author: "J. R. R. Tolkien" },
	{ text: "It does not matter how slowly you go as long as you do not stop.", author: "Confucius" },
	{ text: "The best time to plant a tree was 20 years ago. The second best time is now.", author: "Chinese proverb" },
	{ text: "You miss 100% of the shots you don't take.", author: "Wayne Gretzky" },
	{ text: "Everything you can imagine is real.", author: "Pablo Picasso" },
	{ text: "Turn your wounds into wisdom.", author: "Oprah Winfrey" },
	{ text: "The only limit to our realization of tomorrow is our doubts of today.", author: "Franklin D. Roosevelt" },
	{ text: "Start where you are. Use what you have. Do what you can.", author: "Arthur Ashe" },
	{ text: "What you do makes a difference, and you have to decide what kind of difference you want to make.", author: "Jane Goodall" },
	{ text: "To live is the rarest thing in the world. Most people exist, that is all.", author: "Oscar Wilde" },
	{ text: "Be the change that you wish to see in the world.", author: "Mahatma Gandhi" },
	{ text: "In the middle of difficulty lies opportunity.", author: "Albert Einstein" },
	{ text: "Imagination is more important than knowledge.", author: "Albert Einstein" },
	{ text: "Try not to become a person of success, but rather a person of value.", author: "Albert Einstein" },
	{ text: "We are what we repeatedly do. Excellence, then, is not an act, but a habit.", author: "Will Durant" },
	{ text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
	{ text: "Courage is not the absence of fear, but the triumph over it.", author: "Nelson Mandela" },
	{ text: "If you want to go fast, go alone. If you want to go far, go together.", author: "African proverb" },
	{ text: "A goal without a plan is just a wish.", author: "Antoine de Saint-Exupéry" },
	{ text: "The only person you are destined to become is the person you decide to be.", author: "Ralph Waldo Emerson" },
	{ text: "Go confidently in the direction of your dreams. Live the life you have imagined.", author: "Henry David Thoreau" },
	{ text: "Success is not final, failure is not fatal: it is the courage to continue that counts.", author: "Winston Churchill" },
	{ text: "Don't watch the clock; do what it does. Keep going.", author: "Sam Levenson" },
	{ text: "The way to get started is to quit talking and begin doing.", author: "Walt Disney" },
	{ text: "If you're going through hell, keep going.", author: "Winston Churchill" },
	{ text: "It is never too late to be what you might have been.", author: "George Eliot" },
	{ text: "Life shrinks or expands in proportion to one's courage.", author: "Anaïs Nin" },
	{ text: "Do not go where the path may lead, go instead where there is no path and leave a trail.", author: "Ralph Waldo Emerson" },
	{ text: "Happiness is not something ready made. It comes from your own actions.", author: "Dalai Lama" },
	{ text: "There is no way to happiness — happiness is the way.", author: "Thich Nhat Hanh" },
	{ text: "Smile, breathe and go slowly.", author: "Thich Nhat Hanh" },
	{ text: "You can't stop the waves, but you can learn to surf.", author: "Jon Kabat-Zinn" },
	{ text: "Wherever you are, be there totally.", author: "Eckhart Tolle" },
	{ text: "The present moment is the only moment available to us, and it is the door to all moments.", author: "Thich Nhat Hanh" },
	{ text: "Almost everything will work again if you unplug it for a few minutes, including you.", author: "Anne Lamott" },
	{ text: "Nothing is impossible. The word itself says 'I'm possible!'", author: "Audrey Hepburn" },
	{ text: "Keep your face always toward the sunshine — and shadows will fall behind you.", author: "Walt Whitman" },
	{ text: "Hope is the thing with feathers that perches in the soul.", author: "Emily Dickinson" },
	{ text: "What lies behind us and what lies before us are tiny matters compared to what lies within us.", author: "Ralph Waldo Emerson" },
	{ text: "The world breaks everyone, and afterward, some are strong at the broken places.", author: "Ernest Hemingway" },
	{ text: "This too shall pass.", author: "Persian proverb" },
	{ text: "One day or day one. You decide.", author: "" },
	{ text: "Make it a great day.", author: "" },
];

/**
 * Stable local-date key, e.g. "2026-10-22".
 * @param {Date} [date]
 */
export function quoteDayKey(date = new Date()) {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
		2,
		"0",
	)}-${String(date.getDate()).padStart(2, "0")}`;
}

function hashIndex(key) {
	// FNV-1a, stable across reloads and machines.
	let hash = 2166136261;
	for (let i = 0; i < key.length; i++) {
		hash ^= key.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return Math.abs(hash) % QUOTES.length;
}

/**
 * Pick the quote for a local calendar day. `overrideIndex` is used by the
 * shuffle button and persists for the rest of that day.
 * @param {Date} [date]
 * @param {number|null} [overrideIndex]
 * @returns {{ text: string, author: string, key: string, index: number }}
 */
export function getDailyQuote(date = new Date(), overrideIndex = null) {
	const key = quoteDayKey(date);
	const index =
		Number.isInteger(overrideIndex) ?
			((overrideIndex % QUOTES.length) + QUOTES.length) % QUOTES.length
		:	hashIndex(key);
	return { ...QUOTES[index], key, index };
}

const SHUFFLE_KEY = "quoteShuffle";

/** Read the saved shuffle for the current day, if any. */
export async function loadQuoteShuffle() {
	if (typeof chrome === "undefined" || !chrome.storage?.local) return null;
	try {
		const res = await new Promise((resolve) =>
			chrome.storage.local.get(SHUFFLE_KEY, resolve),
		);
		const value = res?.[SHUFFLE_KEY];
		if (
			value &&
			typeof value.key === "string" &&
			Number.isInteger(value.index)
		) {
			return value;
		}
	} catch (e) {}
	return null;
}

/** Pick a different quote for today and remember it across reloads. */
export async function shuffleQuote(date = new Date()) {
	const key = quoteDayKey(date);
	const saved = await loadQuoteShuffle();
	const base = saved && saved.key === key ? saved.index : hashIndex(key);

	let next = Math.floor(Math.random() * QUOTES.length);
	if (QUOTES.length > 1 && next === base) {
		next = (next + 1) % QUOTES.length;
	}

	const value = { key, index: next };
	if (typeof chrome !== "undefined" && chrome.storage?.local) {
		try {
			await new Promise((resolve) =>
				chrome.storage.local.set({ [SHUFFLE_KEY]: value }, resolve),
			);
		} catch (e) {}
	}

	return getDailyQuote(date, next);
}
