const { TOKEN, IS_DEBUG, MUTE_DURATION_SEC, COUNT_TO_KICK, BRASS_MONKEY_URL, BRASS_MONKEY_COUNT, ON_MUTE_URL } = require("./config.json")
const { Client } = require("discord.js");
const { SpeechClient } = require("@google-cloud/speech");
const fs = require("fs");
const ytdl = require("ytdl-core");

const RESET_COUNT_DURATION_MS = 10000;
const LEAGUE_KEY_PHRASE = "leagueOfLegends";
const BRASS_MONKEY_KEY_PHRASE = "brassMonkey";
const KEY_PHRASES = [LEAGUE_KEY_PHRASE, BRASS_MONKEY_KEY_PHRASE];
const REQUEST_CONFIG =  {
    encoding: "LINEAR16",
    sampleRateHertz: 48000,
    languageCode: "en-US",
    audioChannelCount: 2,
};

const botClient = new Client();
const speechClient = new SpeechClient();
const recentPhraseCount = {}
const phrasePerUserCount = {};

let connection = null;
let messageChannel = null;

const onSayPhrase = (user, keyPhrase) => {
    if (IS_DEBUG) {    
        console.log(`${user.id} said ${keyPhrase}`);
    }
    recentPhraseCount[keyPhrase] += 1;

    const userPhraseKey = `${keyPhrase}_${user.id}`;
    if (phrasePerUserCount[userPhraseKey]) {
        phrasePerUserCount[userPhraseKey] += 1;
    } else {
        phrasePerUserCount[userPhraseKey] = 0;
    }

    if (phrasePerUserCount[userPhraseKey] >= COUNT_TO_KICK) {
        const vcUser = connection.channel.members.find(member => member.id === user.id);

        vcUser.voice.disconnect();
        if (messageChannel == null) {
            return;
        }
        messageChannel.send(`bye bye ${vcUser.displayName}`);   
    }
}

const resetRecentPhraseCount = () => {
    setTimeout(() => {
        KEY_PHRASES.forEach(KEY_PHRASE => {
            if (IS_DEBUG) {
                console.log(`recent count for ${KEY_PHRASE}: ${recentPhraseCount[KEY_PHRASE]}`);
            }
            recentPhraseCount[KEY_PHRASE] = 0;
        });
        resetRecentPhraseCount();
    }, RESET_COUNT_DURATION_MS);
}

const findPhrases = (user, transcription) => {
    if (transcription.includes("league")) {
        onSayLeague(user, "league");
    } else if (transcription.includes("rift")) {
        onSayLeague(user, "rift");
    }
    if (transcription.includes("brass monkey")) {
        onSayBrassMonkey(user);
    }
}

const play = url => {
    const broadcast = botClient.voice.createBroadcast();
    const stream = ytdl(url, { filter: "audioonly" });
    broadcast.play(stream, { seek: 0, volume: 1 });
    connection.play(broadcast);
}

const mute = user => {
    user.voice.setMute(true);
    play(ON_MUTE_URL);
    setTimeout(() => user.voice.setMute(false), MUTE_DURATION_SEC * 1000);
}

const onSayLeague = (user, saidPhrase) => {
    onSayPhrase(user, LEAGUE_KEY_PHRASE);
    
    const vcUser = connection.channel.members.find(member => member.id === user.id);
    mute(vcUser);

    if (messageChannel == null) {
        return;
    }
    messageChannel.send(`${saidPhrase} is a bad word ${vcUser.displayName}`);   
}

const onSayBrassMonkey = user => {
    onSayPhrase(user, BRASS_MONKEY_KEY_PHRASE);

    if (recentPhraseCount[BRASS_MONKEY_KEY_PHRASE] < BRASS_MONKEY_COUNT) {
        return;
    }
    
    play(BRASS_MONKEY_URL);
}

const getTranscription = async (tempFileName) => {
    const bytes = fs.readFileSync(tempFileName).toString("base64");
    const request = {
        audio: {
            content: bytes
        },
        config: REQUEST_CONFIG
    };

    const [response] = await speechClient.recognize(request);
    const transcription = response.results.map(result => result.alternatives[0].transcript).join('\n');

    if (IS_DEBUG) {
        console.log(`transcription: ${transcription}`);
    }
    return transcription.toLowerCase();
}

const listen = (user, talkingStatus) => {
    if (!talkingStatus || user.bot) {
        return;
    }
    const isTalking = talkingStatus.bitfield === 1;
    if (!isTalking) {
        return;
    }
    if (IS_DEBUG) {
        console.log(`${user.id} is talking`);
    }
    
    const audio = connection.receiver.createStream(user, { mode: "pcm" });
    const tempFileName = `./temp/voice_${user.id}.pcm`;
    if (IS_DEBUG) {
        console.log(`writing to ${tempFileName}`);
    }
    audio.pipe(fs.createWriteStream(tempFileName));

    audio.on("end", async () => {
        const transcription = await getTranscription(tempFileName);
        findPhrases(user, transcription)
    });
}

const startSentry = async message => {
    if (IS_DEBUG) {
        console.log("starting sentry");
    }
    messageChannel = message.channel;
    message.channel.send("starting sentry");

    if (message.member.voice.channel == null) {
        message.channel.send("join a voice channel first");
        return;
	}

    connection = await message.member.voice.channel.join();
    connection.on("speaking", listen);
}

const endSentry = () => {
    if (IS_DEBUG) {
        console.log("ending sentry");
    }
    message.channel.send("ending sentry");
    connection.disconnect();
    connection = null;
}

botClient.once("ready", () => console.log("client ready"));
botClient.on("message", async message => {
    const hasStartedSentry = connection != null;
    if (!hasStartedSentry && message.content === "!start sentry") {
        await startSentry(message);
    } else if (hasStartedSentry && message.content === "!end sentry") {
        await endSentry(message);
    }
});

KEY_PHRASES.forEach(KEY_PHRASE => {
    recentPhraseCount[KEY_PHRASE] = 0;
});
botClient.login(TOKEN);
resetRecentPhraseCount();