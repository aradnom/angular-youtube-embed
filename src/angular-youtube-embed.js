angular.module('youtube-embed', ['ng']).run(function () {
    var tag = document.createElement('script');
    tag.src = "//www.youtube.com/iframe_api";
    var firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
})
.service('$youtube', ['$window', '$rootScope', function ($window, $rootScope) {
    // adapted from http://stackoverflow.com/a/5831191/1614967
    var youtubeRegexp = /https?:\/\/(?:[0-9A-Z-]+\.)?(?:youtu\.be\/|youtube(?:-nocookie)?\.com\S*[^\w\s-])([\w-]{11})(?=[^\w-]|$)(?![?=&+%\w.-]*(?:['"][^<>]*>|<\/a>))[?=&+%\w.-]*/ig;
    var timeRegexp = /t=(\d+)[ms]?(\d+)?s?/;

    function contains (str, substr) {
        return (str.indexOf(substr) > -1);
    }

    var service = {
        // Frame is ready
        ready: false,

        // Size
        playerHeight: '390',
        playerWidth: '640',

        currentState: null,

        getIdFromURL: function (url) {
            var id = url.replace(youtubeRegexp, '$1');

            if (contains(id, ';')) {
                var pieces = id.split(';');

                if (contains(pieces[1], '%')) {
                    // links like this:
                    // "http://www.youtube.com/attribution_link?a=pxa6goHqzaA&amp;u=%2Fwatch%3Fv%3DdPdgx30w9sU%26feature%3Dshare"
                    // have the real query string URI encoded behind a ';'.
                    // at this point, `id is 'pxa6goHqzaA;u=%2Fwatch%3Fv%3DdPdgx30w9sU%26feature%3Dshare'
                    var uriComponent = decodeURIComponent(id.split(';')[1]);
                    id = ('http://youtube.com' + uriComponent)
                            .replace(youtubeRegexp, '$1');
                } else {
                    // https://www.youtube.com/watch?v=VbNF9X1waSc&amp;feature=youtu.be
                    // `id` looks like 'VbNF9X1waSc;feature=youtu.be' currently.
                    // strip the ';feature=youtu.be'
                    id = pieces[0]
                }
            } else if (contains(id, '#')) {
                // id might look like '93LvTKF_jW0#t=1'
                // and we want '93LvTKF_jW0'
                id = id.split('#')[0];
            }

            return id;
        },

        getTimeFromURL: function (url) {
            url || (url = '');

            // t=4m20s
            // returns ['t=4m20s', '4', '20']
            // t=46s
            // returns ['t=46s', '46']
            // t=46
            // returns ['t=46', '46']
            var times = url.match(timeRegexp);

            if (!times) {
                // zero seconds
                return 0;
            }

            // assume the first
            var full = times[0],
                minutes = times[1],
                seconds = times[2];

            // t=4m20s
            if (typeof seconds !== 'undefined') {
                seconds = parseInt(seconds, 10);
                minutes = parseInt(minutes, 10);

            // t=4m
            } else if (contains(full, 'm')) {
                minutes = parseInt(minutes, 10);
                seconds = 0;

            // t=4s
            // t=4
            } else {
                seconds = parseInt(minutes, 10);
                minutes = 0;
            }

            // in seconds
            return seconds + (minutes * 60);
        },

        createPlayer: function (playerId, videoId, playerVars) {
            var player = new YT.Player(playerId, {
                height: this.playerHeight,
                width: this.playerWidth,
                videoId: videoId,
                playerVars: playerVars,
                events: {
                    onReady: onPlayerReady,
                    onStateChange: onPlayerStateChange
                }
            });

            // Save reference to player in rootscope so we can easily close
            // existing players before opening a new one
            if (typeof($rootScope.yt_players) !== 'object') $rootScope.yt_players = [];

            $rootScope.yt_players.push(player);

            return player;
        },

        loadPlayer: function (scope, playerId, videoId, playerVars) {
            if (this.ready && playerId && videoId) {
                // Stop any other existing YT players if they exist
                if ($rootScope.yt_players && $rootScope.yt_players.length) {
                    $rootScope.yt_players.forEach( function (player) {
                        if (player.getIframe() && player.getPlayerState() === YT.PlayerState.PLAYING) {
                            player.stopVideo();
                        }
                    });
                }

                // Kill any old players in this scope before making a new one
                if (scope.player && typeof scope.player.destroy === 'function') {
                    scope.player.destroy();
                }

                // Create the new player
                scope.player = this.createPlayer(playerId, videoId, playerVars);
            }
        }
    };

    // YT calls callbacks outside of digest cycle
    function applyBroadcast (event) {
        $rootScope.$apply(function () {
            $rootScope.$broadcast(event);
        });
    }

    // from YT.PlayerState
    var stateNames = {
        0: 'ended',
        1: 'playing',
        2: 'paused',
        3: 'buffering',
        5: 'queued'
    };

    var eventPrefix = 'youtube.player.';

    function onPlayerReady (event) {
        applyBroadcast(eventPrefix + 'ready');
    }

    function onPlayerStateChange (event) {
        var state = stateNames[event.data];
        if (typeof state !== 'undefined') {
            applyBroadcast(eventPrefix + state);
        }
        service.currentState = state;
    }

    // Youtube callback when API is ready
    $window.onYouTubeIframeAPIReady = function () {
        $rootScope.$apply(function () {
            service.ready = true;
        });
    };

    return service;
}])
.directive('youtubeVideo', ['$youtube', function ($youtube) {
    return {
        restrict: 'EA',
        scope: {
            videoId: '=',
            videoUrl: '=',
            playerVars: '='
        },
        link: function (scope, element, attrs) {
            // Attach to element
            var stopWatchingReady = scope.$watch(
                function () {
                    return $youtube.ready
                        // Wait until one of them is defined...
                        && (typeof scope.videoUrl !== 'undefined'
                        ||  typeof scope.videoId !== 'undefined');
                },
                function (ready) {
                    if (ready) {
                        stopWatchingReady();

                        // use URL if you've got it
                        if (typeof scope.videoUrl !== 'undefined') {
                            scope.$watch('videoUrl', function (url) {
                                // Get ID from the URL
                                var id = $youtube.getIdFromURL(url);
                                $youtube.loadPlayer(scope, element[0], id, scope.playerVars);
                            });

                        // otherwise, watch the id
                        } else {
                            scope.$watch('videoId', function (id) {
                                $youtube.videoId = id;

                                // Load the video into the element ID
                                $youtube.loadPlayer(scope, element[0].id, id, scope.playerVars);
                            });
                        }
                    }
            });
        }
    };
}]);
