const retryRepository = require(
    '../repositories/retry.repository'
);

let running = false;

const sleep = async (ms) => {
    await new Promise(resolve => setTimeout(resolve, ms));
};

const startRetryWorker = async () => {
    running = true;

    console.log('Retry Worker started');

    while (running) {
        try {
            const count =
                await retryRepository.scheduleDueRetries(10);

            if (count > 0) {
                console.log(
                    `Scheduled ${count} retry commands`
                );
            }

        } catch (error) {
            console.error(
                'Retry Worker Error:',
                error.message
            );
        }

        await sleep(3000);
    }
};

const stopRetryWorker = () => {
    running = false;
};

module.exports = {
    startRetryWorker,
    stopRetryWorker
};

