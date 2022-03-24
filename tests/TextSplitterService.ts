import TextSplitterService from "../src/contextBuilder/TextSplitterService";
const textSplitter = TextSplitterService({} as any);

// const lines = [
//   "Been fantasising about Chian teaching and guiding the boys on how to rape properly, all during this afternoon; no theory or wording. He'd straight up push them into the actual thing, with live subjects, maybe with a little aid from his shadow tendrils, but would be only to build up their desire and confidence; like when you teach a little one to ride a bike with supporting wheels, heheh... Then once they're feeling ready, he'd let them take on some victim by themselves, perhaps encouraging them to swarm it at the same time, or try and be the first ones on taking it.",
//   "They don't, btw :p",
//   "Ahh, looking on at them penetrate an older girl, just a proud, flaring daddy...",
//   "Wonder if you'll be there when your boy pulls out and his very first cum runs out of that raped pussy...",
//   "I imagine several scenarions; most of them have Chian bringing and incapacitating a girl -could be bigger/older than them, or their same age- for them to explore and experiment. At first, if she's stronger than them, he could hold them down with his strenght, or tendrils, for the little ones to find a way to try with her. Perhaps keep her immobile as one of his kids finds a way to slip inside of her and make her scream with the first draw backs of his young, still soft barbs. Or maybe just bringing small girls like rodents and the such, or young ones who would be completely at the mercy of the eager kits~ So many options...",
//   "So much things to think about lately, and my playful mind seems to don't have brakes, heh~",
//   "My alternative fantasy from last days, is about Aelay's mom, completely bloated in the Cove's shores, and painfully giving birth to a big elemental, in a fully displayed and detailed sequence.. This one's been on my mind for two weeks by now, and I'm very eager to give it a try once I'm free of my responsabilities",
//   "Damn, lovely thoughts bouncing in my lemur's head.",
//   "I've just been thinking of loli me getting fucked and tied by cute foxes...",
//   "This shota pic I've been lusting over has started to make me wanna kiss and lick at horny foxes for some reason...  Just making me want different kinds of boys now.  x3"
// ].join("\n");

const lines = `In the sprawling city of Jasco, a city that has built its wealth from a lucrative silver mining industry, a dark and sinister force has begun to make itself known.  The city is surrounded on all sides by mountains with only a single road leading to the city.
The people of Jasco are a colorful bunch.  While humans still make up the majority of the population, the city has a wide variety of other species living along with them, collectively known as the kemon, or beast-folk.  The city is very culturally diverse and accepting of many norms that humans in other place might find offensive.  Casual nudity is especially commonplace among the kemon and they exist peacefully beside humans.
But despite the idyllic and friendly culture of the city, not all is well within the city.  Monsters have begun attacking in the night, abducting females of any intelligent species.  Jasco has instituted a curfew and begun seeking adventurers to investigate these occurrences.  They have only one lead as to where the attacks are originating from: the tunnels surrounding the city have started to show strange, inhuman tracks leading from them.
Taleir, a female fox and former rogue, has come to the city of Jasco to find more legitimate work.  Like many before her, the accepting culture and numerous opportunities have drawn her here.  She has just caught sight of the city's walls from the back of the wagon carrying her to the city.
Taleir is leaning over the side of the wagon, her tail flipping excitedly, as they slowly approach the walls of the city.  Her driver looks over at her, seeing the tail on her rump sweeping back and forth.  He smiles, giving her a wink.
As they enter the city gates, she sees the guards walking down the road.  As they drive past, the guard gives a wave.  Taleir waves back, smiling, and watches them walk away.
She is going to have to get out of this wagon soon.
The streets are crowded with people coming and going.  Most of them seem to be human, but there are plenty of other races as well.  She spots a few canine faces and several vulpine ones.  She is tempted to go ask someone about the best way to reach the Kemon And Relax, but decides against it.  Instead, she will head for the market.
As the wagon comes to a stop, Taleir hops down onto the street.  The sun is setting, and the light is fading fast.  The city is bustling with activity.  She can hear the sounds of a busy tavern nearby, and the smell of cooking meat fills the air.
Taleir heads into the market square.  The vendor stalls are full of goods.  There are all sorts of things for sale: food, clothes, weapons, tools, jewelry, and more.
Though, Taleir finds little use for clothing, she instead is interested in purchasing some potions.
She walks up to a table piled high with bottles of various colors and sizes.
"Excuse me, I'm looking for some potions."
A canine woman stands behind the table, wearing nothing but a leather vest that's fully open in the front, exposing a furred chest.  Her teats have a proud weight about them, suggesting she has a family to care for.
"I've got some good stuff here," she says.  "What kind of potions are you looking for?"
Taleir looks at the bottles, wondering if she should buy anything.  "Do you have any that are useful against monsters?"
"Oh, you're a bit late for that.  The monster problem has everyone buying up anything even remotely useful for repelling them.  But, I have some healing potions.  If you want to try and control your heat, you might try the Temple of Deynai."
"Deynai?  You mean the temple of the vulpine goddess?"
The vendor nods.  "Yes, that one.  It's right over there.  Go through the market and turn left at the first alley.  It's on the right side of the building."
"Thank you very much!"
Taleir leaves the market and heads toward the alley.
She takes a moment to admire the beautiful sunset.  The sky is filled with purple and orange hues, and the breeze carries a hint of fresh rain.
As she turns the corner, she sees the Temple of Deynai.
It's a simple structure made out of stone and wood, but it appears to be well maintained.  She approaches the door and knocks.
After a few moments, the door opens.
"Welcome to the Temple of Deynai.  How may we help you?"
Taleir steps inside.
Inside the temple is a large hall.  The room is mostly empty, save for a single pew.
There are several candles burning in sconces along the walls, and Taleir notices the scent of incense.
"Hello again, Taleir," a voice calls.`;

const result = [...textSplitter.bySentence(lines)];

result
  .map((i) => JSON.stringify(i.content))
  .forEach((s) => console.log(s));

const l1 = result.map((i) => i.length).reduce((c, p) => c + p);
console.log(`Length: ${lines.length} -- ${l1}`);