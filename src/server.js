let last = new Date("12/1/2019");
const disableSend = false;
const
    Promise = require('bluebird'),
    config = require('config'),
    _ = require('lodash'),
    fs = require('fs'),
    Store = require('./store'),
    log4js = require('log4js');

log4js.configure(config.log4js);
const accountSid = config.twilio.accountSid;
const authToken = config.twilio.authToken;
const logger = log4js.getLogger("server");
const store = new Store(`${__dirname}/../data`);
const moment = require('moment');
const client = require('twilio')(accountSid, authToken);

const schedule = config.schedule;
if (schedule){
    schedule.start = moment(schedule.start || undefined, "MM/DD/YYYY hh:mm a");
    schedule.end = schedule.end ? moment(schedule.end) : undefined;
}

// Check configuration
if (!accountSid){
    logger.error(`The configuration setting 'twilio.accountSid' is required.`);
    return -1;
}

if (!authToken){
    logger.error(`The configuration setting 'twilio.authToken' is required.`);
    return -1;
}

// Start a poll timer
last = getLastProcessed();
//poll();
//setInterval(poll, 1000);

async function poll(){
    try{
        let messages = await client.messages
            .list({
                "dateSentAfter": last,
                to: "+18312260114",
                limit: 20
            });

        messages = _.orderBy(messages, ['dateSent'], ['asc']);
        _.forEach(messages, processMessage);
        let next = _(messages).map(m => new Date(m.dateSent)).max();
        if (next){
            last = new Date(next.getTime() + 1000);
        }
    }
    catch(e){
        logger.error(e);
    }
}

function processMessage(message){
    // If we've already processed this message, skip
    if (store.hasProcessed(message)){
        logger.info(`Skpping message from ${message.from}, already processed...`);
        return;
    }

    logger.info(`Processing message from ${message.from}...`);
    const body = message.body.trim().toLowerCase();

    if (body === "votes"){
        showVotes(message.from);
    } else if (body === "results" && isAdmin(message.from)){
        showResults(message.from);
    } else {
        let user = store.participants[message.from];
        if (user) {
            // User is voting
            vote(message.from, body);
        } else {
            // User is registering
            register(message.from, body);
        }
    }

    store.saveProcessedMessage(message);
}

function showResults(user){

    // For each category
    const categories = _(config.categories).map(c => c.name).value();
    let response = "Results:\n\n";

    for(let category of categories){
        const results = _(store.participants)
            .values()
            .map(p => p.votes[category])
            .flatten()
            .filter(v => !!v)
            .groupBy(id => id)
            .mapValues((votes, id) => { return { id: id, votes: votes.length } })
            .values()
            .orderBy(['votes'], ['desc'])
            .take(5)
            .value();

        if (results.length > 0) {
            response += `${category}:\n`;

            for (result of results) {
                let candidate = candidates[result.id];
                response += `  ${candidate} (${result.votes} votes)\n`
            }

            response += "\n";
        }
    }
    reply(user, response);
}

function isAdmin(user){
    return _.findIndex(config.admins, n => user.endsWith(n)) >= 0;
}

function showVotes(user){
    let participant = store.participants[user];

    if (!participant){
        reply(user, `You have not registered to vote.`);
        return;
    }

    let response = "";
    if (_.keys(participant.votes) === 0){
        response = "You have not voted yet!";
    } else{
        response = "Your votes:\n\n";

        for(let category in participant.votes){
            response += `${category}:\n`

            for(let id of participant.votes[category]){
                response+=`  ${id} - ${candidates[id]}\n`;
            }

            response += "\n";
        }
        response = response.trim();
    }

    reply(user, response);
}

function getCategory(candidateId){
    const category = _.find(config.categories, c => candidateId.match(new RegExp(c.regex)));

    if (category){
        return category.name;
    }
}

function vote(user, body){
    // Make sure this is a known participant
    const participant = store.participants[user];

    // Add their vote
    const id = body.trim().toUpperCase();
    const candidate = candidates[id];
    if (!candidate){
        reply(user, `The value '${id}' is not a registered entry. Please try again.`);
        return;
    }

    const maxVotes = config.maxVotes || 2;
    const category = getCategory(id);
    let votes = participant.votes[category] || [];
    votes.push(id);
    votes = _.uniq(votes);
    participant.votes[category] = votes = votes.slice(votes.length - maxVotes);
    const response = `Vote for "${candidate}" for "${category}" was recieved!`;

    if (votes.length === maxVotes){
        reply(user, `${response}\n\nYou may keep entering votes, however only your last 2 votes for each category will be counted.`);
    } else {
        reply(user, `${response} You have ${maxVotes - votes.length} votes left for "${category}".\n\nSend VOTES to see what you've voted for.`);
    }

    store.save();
}

function register(user, code){
    code = code.toUpperCase();
    let existing = store.registration[code];
    if (!existing){
        reply(user, "The access code you entered is not valid. Check the number and try again.");
        return;
    }

    if (existing.owner && existing.owner !== user){
        reply(user, "The access code you entered has already been claimed.");
    }

    existing.owner = user;
    store.participants[user] = { votes: {} };
    store.save();
    reply(user, `Thanks! You are registered to vote!\n\nWhen voting is opened on ${schedule.start.format("dddd, hA")}, send the entry # you'd like to vote for.`);
}

function reply(user, message){
    logger.info(`Sending message to ${user}: ${message.trim()}`);

    if (disableSend){
        return;
    }

    client.messages.create({
        body: message,
        messagingServiceSid: config.twilio.messagingServiceSid,
        to: user
    })
        .then(m => logger.info(`Sent message: ${message}`))
        .catch(e => logger.error(e));

}

function getLastProcessed(){
    const last = store.lastProcessedMessage();

    if (last){
        return new Date(last + 1000);
    } else{
        return new Date();
    }
}

const candidates = require('../data/candidates.json');
logger.info("Polling for messages...");