# About

**rabbitmq_minionpool** is a specialized [minionpool](https://github.com/marcelog/minionpool) that will let you process tasks coming in
via RabbitMQ (it uses de [node-amqp](https://github.com/postwait/node-amqp) library).

# How it works
You need to provide some key pieces of information:
 * An exchange name (the "worker's exchange" from now on)
 * A queue name (the "worker's queue" from now on)
 * A routing key
 * A retry timeout for failed operations.

When you create a **rabbitmq_minionpool**, 2 exchanges are created in the
rabbitmq server:
 * The exchange name specified (let's say "workers").
 * A [dead letter exchange](http://www.rabbitmq.com/dlx.html) for failed operations, 
 automatically named as the original exchange name and with a suffix ".retry"
 (e.g: "workers.retry").

Both exchanges are created as 'topic', durable', 'not passive'. Also, the channel is
set in 'confirm' mode (in case you want to publish your own messages).

Also, some queues are created:
 * The worker's queue name specified in the given worker's exchange, and binded
 to the given routing key. The pool will subscribe to this queue to get messages.
 This queue is created with the arguments:
  * x-dead-letter-exchange = exchangeName.retry

 * Another queue in the dead letter exchange, so failed operations can get
 there. This queue is created with the arguments:
  * x-dead-letter-exchange = exchangeName
  * x-message-ttl = retryTimeout

When messages are routed to the specified worker's queue, the minionpool will 
dispatch them to the minions. Each minion will get access to the message and the
queue object where it came from. If the minion rejects the message, the message
will be routed to the queue in the dead letter exchange with the given TTL. When
the TTL expires, the message will go back automatically to the original queue,
where the operation can be retried.

# Example

```js
var options = {
  name: 'test',
  debug: true,
  concurrency: 5,
  logger: console.log,
  mqOptions: {
    host: '127.0.0.1',
    login: 'guest',
    password: 'guest',
    authMechanism: 'AMQPLAIN',
    vhost: '/',
    reconnect: true,
    reconnectBackoffStrategy: 'linear',
    reconnectExponentialLimit: 120000,
    reconnectBackoffTime: 1000,
    exchangeName: 'workers',  // Will also create workers.retry
    queueName: 'myWorkers',   // Will also create myWorkers.retry
    routingKey: 'myWorkers',
    retryTimeout: 20000
  },
  minionTaskHandler: function(msg, state, callback) {
    var queue = msg.queue;
    var task = JSON.parse(msg.task.data.toString('utf-8'));
    var err = ...; // Signal errors this way
    console.log('got task: %s', task);
    // reject, don't requeue (i.e: route to the dlx).
    // See the amqp-node doc for more info
    queue.shift(true, false);
    callback(err, state);
  },
  poolEnd: function() {
    process.exit(0);
  }
};

var pool = new minionsMod.RabbitMqMinionPool(options);
process.on('SIGINT', function() {
  pool.end();
});
pool.start();
```

## Tips
 * Design your apps and architecture in such a way that operations are [idempotent](http://en.wikipedia.org/wiki/Idempotence) to max the benefits of this.

