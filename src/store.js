const
    fs = require('fs'),
    _ = require('lodash'),
    log4js = require('log4js');

const logger = log4js.getLogger("store");

class Store{

    constructor(path){
        this._data = null;
        this._processed = null;
        this._dataPath = path + `/data.json`;
        this._processedPath = path + `/processed.json`;
        this._path = path;
        this._load();
    }

    get participants(){
        return this._data.participants;
    }

    get registration(){
        return this._data.registration;
    }

    saveProcessedMessage(message){
        this._processed[message.sid] = {
            uri: message.uri,
            sent: message.dateSent.getTime()
        };
        fs.writeFileSync(this._processedPath, JSON.stringify(this._processed));
    }

    hasProcessed(message){
        return !!this._processed[message.sid];
    }

    lastProcessedMessage(){
        const m = _(this._processed).map(m => m).maxBy("sent");

        if (m){
            return m.sent;
        } else{
            return;
        }
    }

    save(){
        fs.writeFileSync(this._dataPath, JSON.stringify(this._data));
    }

    _load(){

        try{
            this._data = require(this._dataPath);
        } catch(e){
        }

        if (!this._data){
            this._data = { registration:{}, participants: {} };
            let codes = [];
            logger.info("Generating registration codes...");
            const maxCodes = 500;
            while(codes.length < maxCodes){
                const code = Math.round(Math.random() * 99999).toString().padStart(5, "0");
                codes.push(code);

                if (codes.length === maxCodes){
                    codes = _.uniq(codes);
                }
                this._data.registration[code] = { owner: null };
            }

            this.save();

            let csv = "";
            _(codes).forEach(c => {
                csv += `"${c}"\n`
            });
            fs.writeFileSync(this._path + "/codes.csv", csv);
        }

        try{
            this._processed = require(this._processedPath)
        } catch(e){

        }

        if (!this._processed){
            this._processed = {};
        }
    }
}

module.exports = Store;
