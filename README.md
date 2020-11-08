# mqtt-aws-timestream
Bridge to connect an MQTT broker and AWS Timestream. It is compatible with npx usage and installable as global node module.

Configuration is granular, but some parameters are mandatory:
- mqtt broker information
- AWS Timestream tableName and database (they must exist)
- AWS region

# Simple usage
The application needs mqtt broker information. Visit [mqtt's github page](https://github.com/mqttjs/MQTT.js) for full parameters setup.
``` sh
npx mqtt-aws-timestream -h mqtt.mybroker.dev -t tableName -d databaseName -r eu-west-1
```
With this command you'll use all the default values, that is, you will publish all the messages posted on every topic on the specified broker, on `tableName` table on `databaseName` database.
The measure will have a default 'value' name and all the message as value.

> N.B.: you need to have your environment set to work with AWS [(here some help)](https://docs.aws.amazon.com/timestream/latest/developerguide/getting-started.node-js.html#getting-started.node-js.prereqs).

# Advanced usage
You can configure advanced mapping, choose what topics to subscribe to and how is made the record for every topic by configuring a `config.json` file in `cwd` or specifying its path via `--config`, `--cfg` or `-c`.
```
npx mqtt-aws-timestream -c path/to/config.json
```

It is made of three sections: 
- mqtt configuration
- topics configuration
- aws configuration

In mqtt section you can set all the params needed by [mqtt](https://github.com/mqttjs/MQTT.js) to subscribe.

In topics configuration, you put an array of objects containing:
- the topic to subscribe to
- the record configuration

In aws section you can set:
- table
- database
- region

The configuration of each record can be solved using parts of the topic and of the message, that is solved by [json path](https://github.com/JSONPath-Plus/JSONPath).
Every token becomes a `+` during the subscription.

As per default, each message received will cause an immediate write operation to AWS Timestream. To reduce cost, it is better to reduce write operations. For this purpose, you can group consecutive messages of the same topic, up to 100 records per write operation, considering a max timeout since the first message received (timeout can be set using [ms module](https://github.com/vercel/ms)).

e.g.
```json
{
    "aws": {
        "database": "databaseName",
        "table": "tableName",
        "region": "eu-west-1"
    },
    "mqtt": {
        "hostname": "mqtt.mybroker.dev",
        "port": 1883,
        // other mqtt options ...
    },
    "topics": [ {
        "topic": "/abc/iot/{house}/{device}",
        "record": {
            "Dimensions": [{
                "Name": "device",
                "Value": "{device}"
            },{
                "Name": "house",
                "Value": "{house}"
            }],
            "MeasureName": "{house}_{device}",
            "MeasureValue": "$.value",
            "MeasureValueType": "DOUBLE"
        },
        "push": {
            "timeout": "2m",
            "size": 100
        }
    },
    //...
    ]
}
```

More than one configuration topics can match and the data will be written in every node matched.
