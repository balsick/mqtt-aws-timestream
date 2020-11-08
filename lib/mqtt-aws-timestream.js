const { existsSync, readFileSync } = require('fs')
const mqtt = require('mqtt')
const AWS = require('aws-sdk')
const minimist = require('minimist')
const {JSONPath} = require('jsonpath-plus');
const ms = require('ms');

const tokenRegex = /\{(\w+)\}/g

function _start(mqttConfig, configPath, tsParams) {
    let config = {topics: [{topic: (mqttConfig || {}).topic}]}
    if (existsSync(configPath))
        config = JSON.parse(readFileSync(configPath))
    let topics = config.topics
    if (mqttConfig === undefined || mqttConfig.hostname === undefined) {
        console.log(`No explicit configuration set. Searching config.json`)
        if (!config) {
            console.log(`Cannot fine config.json. Quitting`)
            process.exit(1)
        }
        mqttConfig = config.mqtt
    }
    if (config && config.aws && config.aws.region)
        AWS.config.update({ region: config.aws.region });
    console.log(mqttConfig)
    console.log(topics)
    const mqttClient = mqtt.connect(mqttConfig)

    mqttClient.on('connect', (err) => {
        for (let topic of topics) {
            mqttClient.subscribe(initTopic(topic).subscribedTopic)
        }
        console.log(err)
        console.log('connected', topics)
    })
    mqttClient.on('message', (topic, messageBuffer) => {
        console.log(`Received message on topic ${topic}`)
        let message = messageBuffer.toString()
        console.log(message)
        let bridgeTopics = extractBridgeTopics(topics, topic)
        console.log('bridgeTopics')
        console.log(bridgeTopics)
        for (let bc of bridgeTopics) {
            let tokenPositions = bc.topic.split('/').reduce((pv, cv, ci) => {
                pv[ci] = cv
                return pv
            }, [])
            console.log('token positions')
            console.log(tokenPositions)
            let tokenValues = topic.split('/').reduce((pv, cv, ci) => {
                pv[tokenPositions[ci]] = cv
                return pv
            }, {})
            console.log('token values', tokenValues)
            let dbMessage = extractMessage(JSON.parse(message), bc.record || {"MeasureName": "value", "MeasureValue": "$.*"}, bc.tokens, tokenValues)
            if (!dbMessage.Time)
                dbMessage.Time = Date.now().toString()
            if (Number.isInteger(dbMessage.Time))
                dbMessage.Time = dbMessage.Time+""
            console.log(dbMessage)
            const params = {
                DatabaseName: bc.database || config.aws.database || tsParams.database,
                TableName: bc.table || config.aws.table || tsParams.table,
                Records: [dbMessage]
            };

            publish(bc, params)
        }
    })
}

function publish(topic, params) {
    topic.queue.push(params)
    let push = topic.push.size === undefined || topic.push.size === topic.queue.length
    const __publish = () => _publish(topic)
    if (push) {
        console.log(`pushing immediately. queue length is `, topic.queue.length)
        __publish()
    }
    else if (topic.push.timeout && !topic.timer) {
        topic.timer = setTimeout(() => {
            console.log(`timer run out. publishing`)
            __publish()
        }, ms(topic.push.timeout))
        console.log(`timer of ${topic.push.timeout} set`)
    }
}

function _publish(topic) {
    writeClient.writeRecords({
        DatabaseName: topic.queue[0].DatabaseName,
        TableName: topic.queue[0].TableName,
        Records: [].concat.apply([], topic.queue.map(p => p.Records))
    }).promise().then(
        (data) => {
            console.log("Write records successful");
            topic.queue = []
            topic.timer = null
        },
        (err) => {
            console.log("Error writing records:", err);
        }
    );
}

function extractBridgeTopics(topics, topic) {
    return Object.values(topics).filter(tc => {
        let tcArray = tc.subscribedTopic.split('/').filter(s => s.length > 0)
        let topicArray = topic.split('/').filter(s => s.length > 0)
        let tcLength = tcArray.length
        let topicLength = topicArray.length
        if (!tc.topic.endsWith('#') && tcLength !== topicLength)
            return false
        for (let i = 0; i < Math.min(tcLength, topicLength); i++) {
            let tcItem = tcArray[i]
            let topicItem = topicArray[i]
            if (tcItem === topicItem || tcItem === '+')
                continue
            if (tcItem === '#')
                return true
            return false
        }
        return true
    })
}

function extractMessage(message, mapper, tokens, tokenValues) {
    if (!mapper)
        return message
    let dbMessage = {}
    for (let key of Object.keys(mapper)) {
        const path = mapper[key]
        let result
        if (Array.isArray(path))
            result = path.map(item => extractMessage(message, item, tokens, tokenValues))
        else if ((typeof path) === 'object')
            result = extractMessage(message, path, tokens, tokenValues)
        else if ((typeof path) === 'string' && path.startsWith('$'))
            result = JSONPath({path: path, json: message})
        else if ((typeof path) === 'string' && tokens && tokenValues) {
            result = path
            for (let token of tokens) {
                let v = tokenValues[token]
                result = result.replace(token, v)
            }
        }
        else
            result = path
        if (Array.isArray(result) && result.length === 1)
            result = result[0]
        if (result)
            dbMessage[key] = result
    }
    return dbMessage
}

function initTopic(topic) {
    let tokens = topic.topic.match(tokenRegex)
    let t = topic.topic
    topic.subscribedTopic = t
    if (tokens && tokens.length > 0) {
        t = t.replace(tokenRegex, '+')
        topic.tokens = tokens
        topic.subscribedTopic = t
    }
    topic.queue = []
    topic.push = topic.push || {}
    return topic
}

function start (args) {
    let mqttConfig;
    if (args === undefined) {
        args = {serviceaccount: './serviceaccount.json'}
    } else {
        args = minimist(args, {
            string: ['hostname', 'username', 'password', 'key', 'cert', 'ca', 'clientId', 'database', 'config', 'region', 'table'],
            boolean: ['help', 'insecure', 'multiline'],
            alias: {
                //mqtt
                port: 'p',
                hostname: ['h', 'host'],
                topic: 't',
                clientId: ['i', 'id'],
                username: 'u',
                password: 'P',
                multiline: 'M',
                protocol: ['C', 'l'],
                help: 'H',
                ca: 'cafile',
                //aws
                region: 'r',
                database: 'db',
                table: 'T',
                config: ['c', 'cfg']
            },
            default: {
                topic: '#',
                config: 'config.json'
            }
            })
        mqttConfig = {port: args.port, topic: args.topic, username: args.username, password: args.password, ca: args.ca, hostname: args.hostname, clientId: args.clientId}
    }
    // if (!args.serviceaccount) {
    //     console.log('missing serviceaccount file')
    //     process.exit(1)
    // }
    if (args.region)
        AWS.config.update({ region: args.region });
    var https = require('https');
    var agent = new https.Agent({
        maxSockets: 5000
    });
    writeClient = new AWS.TimestreamWrite({
            maxRetries: 10,
            httpOptions: {
                timeout: 20000,
                agent: agent
            }
        });
    const params = {
        DatabaseName: args.database,
        TableName: args.table
    };
    _start(mqttConfig, args.config, params)
}

exports.start = start