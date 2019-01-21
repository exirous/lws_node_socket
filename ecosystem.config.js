module.exports = {
    apps: [
        {
            name:               'LWS (old)',
            script:             'socketapp.js',
            instances:          1,
            autorestart:        true,
            watch:              true,
            max_memory_restart: '300M'
        }
    ]
};