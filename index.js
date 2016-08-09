'use strict';

const app = require('express')();
const _ = require('lodash');
const axios = require('axios');

const updateInterval = 5 * 60 * 1000; // 5 minutes
const countries = require('./countries');
const api_url = 'http://wowappprd.rio2016.com';
const feed_url = `${api_url}/json/medals/OG2016_medalsList.json`;

// In memory cache
let cachedResponse = {};

function update(callback) {
    axios.get(feed_url).then(response => {
        let medalsList = _.result(response, 'data.body.medalRank.medalsList');
        if (!medalsList) return callback('No medals in the response');

        let medals = countries.map(country => {
            let countryMedals = _.find(medalsList, {noc_code: country.noc}) || {};
            return {
                flag: country.flag,
                noc: country.noc,
                name: country.name,
                bronze: parseInt(countryMedals.me_bronze || "0"),
                silver: parseInt(countryMedals.me_silver || "0"),
                gold: parseInt(countryMedals.me_gold || "0"),
                total: parseInt(countryMedals.me_tot || "0")
            };
        });
        medals = _.orderBy(medals, ['total'], ['desc']);

        cachedResponse = {
            lastUpdated: new Date().toISOString(),
            totalCountries: medals.length,
            medals: medals
        };

        callback();
    }, err => callback(err));
}


function updateTiming() {
    update(err => {
        // Randomize the scraping time a bit
        let nextUpdateTimeout = Math.round((Math.random() * 10000) + updateInterval);
        if (err) {
            console.log(err);
            nextUpdateTimeout = nextUpdateTimeout / 2;
        }
        if (nextUpdateTimeout < 10000) nextUpdateTimeout = 10000;
        console.log(`next call in ${nextUpdateTimeout}ms`);
        cachedResponse.nextUpdate = new Date(Date.now() + nextUpdateTimeout).toISOString();
        setTimeout(updateTiming, nextUpdateTimeout);
    });
}
updateTiming();


app.get('/', (req, res) => res.send('Hi there!'));
app.get('/medals', (req, res) => res.json(cachedResponse));

// Express app listen
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`App listening on port ${port}`));