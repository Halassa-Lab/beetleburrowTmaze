// Initialize jsPsych
const jsPsych = initJsPsych({
    on_finish: function() {
        // Display data at the end
        jsPsych.data.displayData('csv');
    }
});

// Global variables
let currentPhase = 1;
let trialCount = 0;
let firstBugType = null;
let secondBugType = null;

// Audio components
let audioContext;
let gainNode;
let biquadFilter;
let isAudioInitialized = false;

// Predation probabilities
const predationProbabilities = {
    'red_orange_beetle': { 'Pink': 0.2, 'Orange': 0.8, 'Yellow': 0.5 },
    'blue_beetle': { 'Pink': 0.9, 'Orange': 0.3, 'Yellow': 0.6 }
};

// Create custom plugin for the H-Maze task
const HMazePlugin = (function(jspsych) {
    const info = {
        name: 'hmaze-task',
        parameters: {
            bug_type: {
                type: 'STRING',
                pretty_name: 'Bug Type',
                default: 'red_orange_beetle'
            },
            phase: {
                type: 'INT',
                pretty_name: 'Phase',
                default: 1
            },
            trial_number: {
                type: 'INT',
                pretty_name: 'Trial Number',
                default: 1
            },
            response_time_limit: {
                type: 'INT',
                pretty_name: 'Response Time Limit',
                default: 5000
            }
        }
    };

    class HMazePluginClass {
        constructor(jsPsych) {
            this.jsPsych = jsPsych;
        }

        trial(display_element, trial) {
            const plugin = this;
            
            // Local oscillator variable for this trial only
            let oscillator = null;
            let oscillatorStarted = false;
            
            // Create and load image objects
            const images = {
                red_bug: new Image(),
                blue_bug: new Image(),
                Pink: new Image(),
                Orange: new Image(),
                Yellow: new Image()
            };
            images.red_bug.src = 'red_bug.png';
            images.blue_bug.src = 'blue_bug.png';
            images.Pink.src = 'Pink.png';
            images.Orange.src = 'Orange.png';
            images.Yellow.src = 'Yellow.png';
            
            // Setup canvas
            const canvas = document.createElement('canvas');
            canvas.width = 1000;
            canvas.height = 600;
            canvas.style.border = '4px solid #6d4c41';
            canvas.style.borderRadius = '15px';
            canvas.style.boxShadow = '0 15px 50px rgba(0, 0, 0, 0.3)';
            canvas.style.background = '#f5e6d3';
            canvas.style.cursor = 'pointer';
            display_element.appendChild(canvas);

            const ctx = canvas.getContext('2d');

            // Colors
            const colors = {
                maze: '#4a3426',
                mazeHighlight: '#5d4037',
                background: '#faf8f5',
                pocketBase: 'rgba(205, 133, 63, 0.3)',
                text: '#3e2723',
                correctFeedback: '#689f38',
                incorrectFeedback: '#d84315'
            };

            // H-Maze dimensions
            const stemWidth = 40;
            const centerStemHeight = 100;
            const armHeight = 40;
            const centerArmLeftLength = 200;
            const centerArmRightLength = 200;
            const sideArmTopLeftLength = 150;
            const sideArmBottomLeftLength = 120;
            const sideArmTopRightLength = 100;
            const sideArmBottomRightLength = 180;
            
            const horizontalWidth = centerArmLeftLength + stemWidth + centerArmRightLength;
            const leftBoundary = (canvas.width - horizontalWidth) / 2;
            const rightBoundary = leftBoundary + horizontalWidth;
            const mazeX = leftBoundary + centerArmLeftLength;
            const centerJunctionY = (canvas.height / 2) - (armHeight / 2);
            const mazeY = centerJunctionY - centerStemHeight;
            const leftJunctionX = leftBoundary + armHeight / 2;
            const rightJunctionX = rightBoundary - armHeight / 2;

            // Predator setup
            const predators = ['Pink', 'Orange', 'Yellow'];
            const predatorPositions = {};
            
            // Randomly assign predators to all 6 pockets
            const positions = ['centerLeft', 'centerRight', 'topLeft', 'bottomLeft', 'topRight', 'bottomRight'];
            positions.forEach(pos => {
                predatorPositions[pos] = predators[Math.floor(Math.random() * predators.length)];
            });

            // Pocket positions
            const pocketRadius = 35;
            const pockets = {
                centerLeft: { x: mazeX - pocketRadius, y: centerJunctionY + armHeight },
                centerRight: { x: mazeX + stemWidth + pocketRadius, y: centerJunctionY + armHeight },
                topLeft: { x: leftBoundary, y: centerJunctionY - 30 },
                bottomLeft: { x: leftBoundary, y: centerJunctionY + armHeight + 30 },
                topRight: { x: rightBoundary, y: centerJunctionY - 30 },
                bottomRight: { x: rightBoundary, y: centerJunctionY + armHeight + 30 }
            };

            // Danger zones
            const dangerZones = {
                centerLeft: { axis: 'x', start: pockets.centerLeft.x - pocketRadius, end: pockets.centerLeft.x + pocketRadius },
                centerRight: { axis: 'x', start: pockets.centerRight.x - pocketRadius, end: pockets.centerRight.x + pocketRadius },
                topLeft: { axis: 'y', start: pockets.topLeft.y - pocketRadius, end: pockets.topLeft.y + pocketRadius },
                bottomLeft: { axis: 'y', start: pockets.bottomLeft.y - pocketRadius, end: pockets.bottomLeft.y + pocketRadius },
                topRight: { axis: 'y', start: pockets.topRight.y - pocketRadius, end: pockets.topRight.y + pocketRadius },
                bottomRight: { axis: 'y', start: pockets.bottomRight.y - pocketRadius, end: pockets.bottomRight.y + pocketRadius }
            };

            // Bug setup
            const BASE_BUG_SPEED = 1.5;
            const FAST_BUG_SPEED = 3.0;
            
            let bug = {
                x: mazeX + (stemWidth / 2),
                y: mazeY,
                width: 30,
                height: 40,
                type: trial.bug_type,
                speed: BASE_BUG_SPEED,
                normalSpeed: BASE_BUG_SPEED,
                fastSpeed: FAST_BUG_SPEED,
                visible: true,
                direction1: null,
                direction2: null,
                actualOutcome: null,
                isInDangerZone: false
            };

            // Clickable zones
            const exitZoneHeight = 60;
            const clickableZones = {
                'escaped-top-left': { x: leftBoundary, y: centerJunctionY - sideArmTopLeftLength, width: armHeight, height: exitZoneHeight },
                'escaped-bottom-left': { x: leftBoundary, y: centerJunctionY + armHeight + sideArmBottomLeftLength - exitZoneHeight, width: armHeight, height: exitZoneHeight },
                'escaped-top-right': { x: rightBoundary - armHeight, y: centerJunctionY - sideArmTopRightLength, width: armHeight, height: exitZoneHeight },
                'escaped-bottom-right': { x: rightBoundary - armHeight, y: centerJunctionY + armHeight + sideArmBottomRightLength - exitZoneHeight, width: armHeight, height: exitZoneHeight },
                'eaten-center-left': { x: pockets.centerLeft.x - pocketRadius, y: pockets.centerLeft.y, width: pocketRadius * 2, height: pocketRadius },
                'eaten-center-right': { x: pockets.centerRight.x - pocketRadius, y: pockets.centerRight.y, width: pocketRadius * 2, height: pocketRadius },
                'eaten-top-left': { x: pockets.topLeft.x - pocketRadius, y: pockets.topLeft.y - pocketRadius, width: pocketRadius, height: pocketRadius * 2 },
                'eaten-bottom-left': { x: pockets.bottomLeft.x - pocketRadius, y: pockets.bottomLeft.y - pocketRadius, width: pocketRadius, height: pocketRadius * 2 },
                'eaten-top-right': { x: pockets.topRight.x, y: pockets.topRight.y - pocketRadius, width: pocketRadius, height: pocketRadius * 2 },
                'eaten-bottom-right': { x: pockets.bottomRight.x, y: pockets.bottomRight.y - pocketRadius, width: pocketRadius, height: pocketRadius * 2 }
            };

            // Game state
            let gameState = 'start';
            let animationId = null;
            let responseTimer = null;
            let startTime = null;
            let clickTime = null;

            // Trial data
            let trial_data = {
                phase: trial.phase,
                trial: trial.trial_number,
                bug_type: trial.bug_type,
                predator_centerLeft: predatorPositions.centerLeft,
                predator_centerRight: predatorPositions.centerRight,
                predator_topLeft: predatorPositions.topLeft,
                predator_bottomLeft: predatorPositions.bottomLeft,
                predator_topRight: predatorPositions.topRight,
                predator_bottomRight: predatorPositions.bottomRight,
                bug_path: null,
                actual_outcome: null,
                user_choice: null,
                correct: false,
                rt: null
            };

            // Drawing functions
            function drawHMaze() {
                ctx.save();
                const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
                gradient.addColorStop(0, colors.mazeHighlight);
                gradient.addColorStop(1, colors.maze);
                ctx.fillStyle = gradient;
                
                // Center stem
                ctx.fillRect(mazeX, mazeY, stemWidth, centerStemHeight);
                // Horizontal bar
                ctx.fillRect(leftBoundary, centerJunctionY, horizontalWidth, armHeight);
                // Left arms
                ctx.fillRect(leftBoundary, centerJunctionY - sideArmTopLeftLength, armHeight, sideArmTopLeftLength);
                ctx.fillRect(leftBoundary, centerJunctionY + armHeight, armHeight, sideArmBottomLeftLength);
                // Right arms
                ctx.fillRect(rightBoundary - armHeight, centerJunctionY - sideArmTopRightLength, armHeight, sideArmTopRightLength);
                ctx.fillRect(rightBoundary - armHeight, centerJunctionY + armHeight, armHeight, sideArmBottomRightLength);
                
                ctx.restore();
            }

            function drawPredatorPockets() {
                const drawPocket = (pocket, predatorName, orientation) => {
                    let angleStart, angleEnd;
                    let visualX = pocket.x, visualY = pocket.y;

                    switch (orientation) {
                        case 'up':
                            angleStart = 0; angleEnd = Math.PI;
                            visualY += pocketRadius / 2;
                            break;
                        case 'left':
                            angleStart = Math.PI * 0.5; angleEnd = Math.PI * 1.5;
                            visualX -= pocketRadius / 2;
                            break;
                        case 'right':
                            angleStart = Math.PI * 1.5; angleEnd = Math.PI * 0.5;
                            visualX += pocketRadius / 2;
                            break;
                    }
                    
                    const gradient = ctx.createRadialGradient(pocket.x, pocket.y, 0, pocket.x, pocket.y, pocketRadius);
                    gradient.addColorStop(0, 'rgba(205, 133, 63, 0.4)');
                    gradient.addColorStop(1, 'rgba(139, 90, 43, 0.2)');
                    ctx.fillStyle = gradient;
                    ctx.beginPath();
                    ctx.arc(pocket.x, pocket.y, pocketRadius, angleStart, angleEnd);
                    ctx.fill();
                    ctx.strokeStyle = 'rgba(139, 90, 43, 0.5)';
                    ctx.lineWidth = 2;
                    ctx.stroke();

                    const predatorImage = images[predatorName];
                    if (predatorImage && predatorImage.complete) {
                        const predatorImgHeight = 33;
                        const predatorImgWidth = predatorImgHeight * (2 / 3);
                        const predatorX = visualX - predatorImgWidth / 2;
                        const predatorY = visualY - predatorImgHeight / 2 + 5;
                        ctx.drawImage(predatorImage, predatorX, predatorY, predatorImgWidth, predatorImgHeight);
                    }
                };

                drawPocket(pockets.centerLeft, predatorPositions.centerLeft, 'up');
                drawPocket(pockets.centerRight, predatorPositions.centerRight, 'up');
                drawPocket(pockets.topLeft, predatorPositions.topLeft, 'left');
                drawPocket(pockets.bottomLeft, predatorPositions.bottomLeft, 'left');
                drawPocket(pockets.topRight, predatorPositions.topRight, 'right');
                drawPocket(pockets.bottomRight, predatorPositions.bottomRight, 'right');
            }

            // Audio functions
            function playTone() {
                if (!isAudioInitialized) return;
                
                stopTone();
                
                try {
                    oscillator = audioContext.createOscillator();
                    oscillator.type = 'sawtooth';
                    
                    const localGain = audioContext.createGain();
                    localGain.gain.setValueAtTime(0.1, audioContext.currentTime);
                    
                    oscillator.connect(biquadFilter);
                    biquadFilter.connect(localGain);
                    localGain.connect(audioContext.destination);
                    
                    oscillator.start();
                    oscillatorStarted = true;
                    
                    oscillator.localGain = localGain;
                    
                    updateAudio();
                } catch(e) {
                    console.warn('Failed to start audio:', e);
                }
            }

            function stopTone() {
                if (oscillator) {
                    try {
                        if (oscillatorStarted) {
                            oscillator.stop();
                        }
                    } catch(e) {}
                    
                    try {
                        oscillator.disconnect();
                        if (oscillator.localGain) {
                            oscillator.localGain.disconnect();
                        }
                    } catch(e) {}
                    
                    oscillator = null;
                    oscillatorStarted = false;
                }
                
                if (biquadFilter) {
                    try {
                        biquadFilter.disconnect();
                    } catch(e) {}
                    
                    if (isAudioInitialized && audioContext) {
                        biquadFilter = audioContext.createBiquadFilter();
                    }
                }
            }

            function updateAudio() {
                if (!isAudioInitialized || !oscillator || !oscillatorStarted) return;
                
                try {
                    const freq = bug.speed * 100 + 150;
                    oscillator.frequency.setValueAtTime(freq, audioContext.currentTime);

                    if (bug.isInDangerZone) {
                        biquadFilter.type = 'highpass';
                        biquadFilter.frequency.setValueAtTime(1200, audioContext.currentTime);
                    } else {
                        biquadFilter.type = 'lowpass';
                        biquadFilter.frequency.setValueAtTime(500, audioContext.currentTime);
                    }
                } catch(e) {}
            }

            function drawBug() {
                if (bug.visible) {
                    const bugImage = (bug.type === 'red_orange_beetle') ? images.red_bug : images.blue_bug;
                    if (bugImage && bugImage.complete) {
                        ctx.drawImage(bugImage, bug.x - bug.width / 2, bug.y - bug.height / 2, bug.width, bug.height);
                    }
                }
            }

            function drawUI() {
                ctx.fillStyle = colors.text;
                ctx.font = '600 16px sans-serif';
                ctx.textAlign = 'left';
                ctx.fillText(`Trial: ${trial.trial_number} (Phase: ${trial.phase})`, 20, 30);

                if (gameState === 'start') {
                    ctx.font = '700 24px serif';
                    ctx.textAlign = 'center';
                    ctx.fillText('Click to Start', canvas.width / 2, canvas.height / 2);
                } else if (gameState === 'awaitingInput') {
                    ctx.font = '600 18px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText('What was the outcome? Click the area.', canvas.width / 2, 50);
                    
                    // Highlight clickable zones
                    ctx.save();
                    ctx.globalAlpha = 0.35;
                    
                    // Exit zones
                    ctx.fillStyle = '#3498db';
                    for (const outcome in clickableZones) {
                        if (outcome.startsWith('escaped')) {
                            const zone = clickableZones[outcome];
                            ctx.fillRect(zone.x, zone.y, zone.width, zone.height);
                        }
                    }
                    
                    // Pocket zones
                    ctx.fillStyle = '#e74c3c';
                    const drawPocketOverlay = (pocket, orientation) => {
                        ctx.beginPath();
                        let angleStart, angleEnd;
                        switch (orientation) {
                            case 'up': angleStart = 0; angleEnd = Math.PI; break;
                            case 'left': angleStart = Math.PI * 0.5; angleEnd = Math.PI * 1.5; break;
                            case 'right': angleStart = Math.PI * 1.5; angleEnd = Math.PI * 0.5; break;
                        }
                        ctx.arc(pocket.x, pocket.y, pocketRadius, angleStart, angleEnd);
                        ctx.fill();
                    };

                    drawPocketOverlay(pockets.centerLeft, 'up');
                    drawPocketOverlay(pockets.centerRight, 'up');
                    drawPocketOverlay(pockets.topLeft, 'left');
                    drawPocketOverlay(pockets.bottomLeft, 'left');
                    drawPocketOverlay(pockets.topRight, 'right');
                    drawPocketOverlay(pockets.bottomRight, 'right');
                    
                    ctx.restore();
                }
            }

            function drawFeedback() {
                ctx.font = '700 24px serif';
                ctx.textAlign = 'center';
                ctx.fillStyle = trial_data.correct ? colors.correctFeedback : colors.incorrectFeedback;
                ctx.fillText(trial_data.correct ? 'Correct!' : 'Incorrect!', canvas.width / 2, 50);

                // Highlight correct answer
                if (trial_data.user_choice !== 'miss') {
                    const correctZoneKey = bug.actualOutcome;
                    if (correctZoneKey && clickableZones[correctZoneKey]) {
                        const zone = clickableZones[correctZoneKey];
                        
                        ctx.save();
                        ctx.globalAlpha = 0.5;
                        ctx.fillStyle = colors.correctFeedback;

                        if (correctZoneKey.startsWith('escaped')) {
                            ctx.fillRect(zone.x, zone.y, zone.width, zone.height);
                        } else {
                            let pocketKey, orientation;
                            if (correctZoneKey === 'eaten-top-left') { pocketKey = 'topLeft'; orientation = 'left'; }
                            else if (correctZoneKey === 'eaten-bottom-left') { pocketKey = 'bottomLeft'; orientation = 'left'; }
                            else if (correctZoneKey === 'eaten-top-right') { pocketKey = 'topRight'; orientation = 'right'; }
                            else if (correctZoneKey === 'eaten-bottom-right') { pocketKey = 'bottomRight'; orientation = 'right'; }
                            else if (correctZoneKey === 'eaten-center-left') { pocketKey = 'centerLeft'; orientation = 'up'; }
                            else if (correctZoneKey === 'eaten-center-right') { pocketKey = 'centerRight'; orientation = 'up'; }
                            
                            const pocket = pockets[pocketKey];
                            ctx.beginPath();
                            let angleStart, angleEnd;
                            switch (orientation) {
                                case 'up': angleStart = 0; angleEnd = Math.PI; break;
                                case 'left': angleStart = Math.PI * 0.5; angleEnd = Math.PI * 1.5; break;
                                case 'right': angleStart = Math.PI * 1.5; angleEnd = Math.PI * 0.5; break;
                            }
                            ctx.arc(pocket.x, pocket.y, pocketRadius, angleStart, angleEnd);
                            ctx.fill();
                        }
                        ctx.restore();
                    }
                }
            }

            function update() {
                if (gameState !== 'running') return;

                if (bug.direction1 === null) {
                    if (bug.y < centerJunctionY + armHeight / 2) {
                        bug.y += bug.speed;
                    } else {
                        bug.y = centerJunctionY + armHeight / 2;
                        bug.direction1 = Math.random() < 0.5 ? 'left' : 'right';
                        bug.visible = false;

                        const centralPredatorKey = bug.direction1 === 'left' ? 'centerLeft' : 'centerRight';
                        const predator = predatorPositions[centralPredatorKey];
                        const probability = predationProbabilities[bug.type][predator];

                        if (Math.random() < probability) {
                            bug.actualOutcome = `eaten-center-${bug.direction1}`;
                        }
                    }
                } else if (bug.direction2 === null) {
                    // Check danger zone for central path
                    const wasInDangerZone = bug.isInDangerZone;
                    const dangerKey = bug.direction1 === 'left' ? 'centerLeft' : 'centerRight';
                    const zone = dangerZones[dangerKey];
                    bug.isInDangerZone = (bug.x > zone.start && bug.x < zone.end);
                    
                    if (wasInDangerZone !== bug.isInDangerZone) {
                        bug.speed = bug.isInDangerZone ? bug.fastSpeed : bug.normalSpeed;
                        updateAudio();
                    }

                    bug.x += (bug.direction1 === 'left' ? -1 : 1) * bug.speed;

                    if (bug.actualOutcome !== null) {
                        const stopX = bug.direction1 === 'left' ? pockets.centerLeft.x : pockets.centerRight.x;
                        if ((bug.direction1 === 'left' && bug.x <= stopX) || (bug.direction1 === 'right' && bug.x >= stopX)) {
                            bug.x = stopX;
                            endTrial();
                        }
                    } else {
                        const targetX = bug.direction1 === 'left' ? leftJunctionX : rightJunctionX;
                        if ((bug.direction1 === 'left' && bug.x <= targetX) || (bug.direction1 === 'right' && bug.x >= targetX)) {
                            bug.x = targetX;
                            bug.direction2 = Math.random() < 0.5 ? 'top' : 'bottom';

                            const finalPredatorKey = `${bug.direction2}${bug.direction1.charAt(0).toUpperCase() + bug.direction1.slice(1)}`;
                            const predator = predatorPositions[finalPredatorKey];
                            const probability = predationProbabilities[bug.type][predator];

                            if (Math.random() < probability) {
                                bug.actualOutcome = `eaten-${bug.direction2}-${bug.direction1}`;
                            } else {
                                bug.actualOutcome = `escaped-${bug.direction2}-${bug.direction1}`;
                            }
                            
                            bug.isInDangerZone = false;
                            bug.speed = bug.normalSpeed;
                            updateAudio();
                        }
                    }
                } else {
                    // Moving vertically on side arms
                    const wasInDangerZone = bug.isInDangerZone;
                    const finalPredatorKey = `${bug.direction2}${bug.direction1.charAt(0).toUpperCase() + bug.direction1.slice(1)}`;
                    const zone = dangerZones[finalPredatorKey];

                    if (zone.axis === 'y') {
                        bug.isInDangerZone = (bug.y > zone.start && bug.y < zone.end);
                    }

                    if (wasInDangerZone !== bug.isInDangerZone) {
                        bug.speed = bug.isInDangerZone ? bug.fastSpeed : bug.normalSpeed;
                        updateAudio();
                    }

                    bug.y += (bug.direction2 === 'top' ? -1 : 1) * bug.speed;

                    if (bug.actualOutcome.startsWith('eaten')) {
                        const pocket = pockets[finalPredatorKey];
                        if ((bug.direction2 === 'top' && bug.y <= pocket.y) || (bug.direction2 === 'bottom' && bug.y >= pocket.y)) {
                            endTrial();
                        }
                    } else {
                        let exitY;
                        if (bug.direction1 === 'left' && bug.direction2 === 'top') {
                            exitY = centerJunctionY - sideArmTopLeftLength;
                            if (bug.y <= exitY) endTrial();
                        } else if (bug.direction1 === 'left' && bug.direction2 === 'bottom') {
                            exitY = centerJunctionY + armHeight + sideArmBottomLeftLength;
                            if (bug.y >= exitY) endTrial();
                        } else if (bug.direction1 === 'right' && bug.direction2 === 'top') {
                            exitY = centerJunctionY - sideArmTopRightLength;
                            if (bug.y <= exitY) endTrial();
                        } else if (bug.direction1 === 'right' && bug.direction2 === 'bottom') {
                            exitY = centerJunctionY + armHeight + sideArmBottomRightLength;
                            if (bug.y >= exitY) endTrial();
                        }
                    }
                }

                // Set bug path for data
                if (bug.direction1 && !trial_data.bug_path) {
                    let pathDescription = bug.direction1;
                    if (bug.direction2) {
                        pathDescription += `-${bug.direction2}`;
                    }
                    trial_data.bug_path = pathDescription;
                }
            }

            function endTrial() {
                stopTone();
                gameState = 'awaitingInput';
                clickTime = performance.now();
                
                // Set final path and outcome
                let pathDescription = bug.direction1;
                if (bug.direction2) {
                    pathDescription += `-${bug.direction2}`;
                }
                trial_data.bug_path = pathDescription;
                trial_data.actual_outcome = bug.actualOutcome;
                
                responseTimer = setTimeout(() => {
                    if (gameState === 'awaitingInput') {
                        trial_data.user_choice = 'miss';
                        trial_data.correct = false;
                        trial_data.rt = trial.response_time_limit;
                        
                        gameState = 'feedback';
                        ctx.clearRect(0, 0, canvas.width, canvas.height);
                        drawHMaze();
                        drawPredatorPockets();
                        
                        ctx.font = '700 24px serif';
                        ctx.textAlign = 'center';
                        ctx.fillStyle = colors.incorrectFeedback;
                        ctx.fillText('Miss', canvas.width / 2, 50);
                        
                        setTimeout(() => finishTrial(), 1500);
                    }
                }, trial.response_time_limit);
            }

            function render() {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                drawHMaze();
                drawPredatorPockets();
                drawBug();
                drawUI();
                
                if (gameState === 'feedback') {
                    drawFeedback();
                }
            }

            function handleClick(e) {
                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;

                if (gameState === 'start') {
                    gameState = 'running';
                    startTime = performance.now();
                    playTone();
                    const animate = () => {
                        update();
                        render();
                        if (gameState === 'running') {
                            animationId = requestAnimationFrame(animate);
                        }
                    };
                    animationId = requestAnimationFrame(animate);
                } else if (gameState === 'awaitingInput') {
                    for (const outcome in clickableZones) {
                        const zone = clickableZones[outcome];
                        if (x >= zone.x && x <= zone.x + zone.width && 
                            y >= zone.y && y <= zone.y + zone.height) {
                            clearTimeout(responseTimer);
                            trial_data.user_choice = outcome;
                            trial_data.correct = (outcome === bug.actualOutcome);
                            trial_data.rt = performance.now() - clickTime;
                            
                            gameState = 'feedback';
                            render();
                            setTimeout(() => finishTrial(), 1500);
                            break;
                        }
                    }
                }
            }

            const finishTrial = () => {
                stopTone();
                
                if (animationId != null) {
                    cancelAnimationFrame(animationId);
                    animationId = null;
                }
                
                if (responseTimer) {
                    clearTimeout(responseTimer);
                    responseTimer = null;
                }
                
                canvas.removeEventListener('click', handleClick);
                display_element.innerHTML = '';
                
                plugin.jsPsych.finishTrial(trial_data);
            }

            // Start the trial
            canvas.addEventListener('click', handleClick);
            render();
        }
    }

    HMazePluginClass.info = info;
    return HMazePluginClass;
})(jsPsych);

// Function to set up audio context
function setupAudio() {
    if (isAudioInitialized) return;
    
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }
        
        gainNode = audioContext.createGain();
        biquadFilter = audioContext.createBiquadFilter();
        gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
        
        isAudioInitialized = true;
    } catch(e) {
        console.warn('Audio initialization failed:', e);
        isAudioInitialized = false;
    }
}

// Welcome screen
const welcome_trial = {
    type: jsPsychHtmlButtonResponse,
    stimulus: '<h1 style="font-family: Georgia, serif; color: #5d4037;">Halassa Lab\'s Beetle Burrow H-Maze</h1><p style="font-family: Georgia, serif;font-size: 18px;">Welcome to the experiment!</p>',
    choices: ['Begin'],
    on_finish: function() {
        setupAudio();
    }
};

// Instructions
const instructions = {
    type: jsPsychInstructions,
    pages: [
        `<div style="background:#f5e6d3; padding: 50px; border-radius: 20px; max-width: 800px; margin: auto;">
            <h1 style="font-family:Georgia, serif;color: #5d4037;">Instructions</h1>
            <p><strong>Goal:</strong> Your objective is to predict the outcome of a beetle's journey through an H-shaped maze.</p>
            <p><strong>How it works:</strong></p>
            <ul style="text-align: left;">
                <li>In each trial, a beetle will start at the bottom of the center stem and run upwards.</li>
                <li>At the center junction, it will turn either left or right.</li>
                <li>The beetle may be eaten by a predator at the center junction, or continue to the side.</li>
                <li>If it continues, it will then turn up or down at the side junction.</li>
                <li>At each endpoint and junction, there are predators with different probabilities of catching different beetles.</li>
                <li>The beetle will either be <strong>eaten</strong> by a predator or <strong>escape</strong> past it.</li>
                <li>After the beetle's run, you must click on the area where you believe the trial ended.</li>
                <li>You will receive immediate feedback on whether your prediction was correct.</li>
            </ul>
            <p>Pay close attention to the beetle type and the predators to learn the patterns!</p>
        </div>`
    ],
    show_clickable_nav: true,
    button_label_previous: 'Back',
    button_label_next: 'Begin'
};

// Initialize bug types
const initialize_bug_types = {
    type: jsPsychHtmlKeyboardResponse,
    stimulus: '',
    trial_duration: 0,
    on_finish: function() {
        if (Math.random() < 0.5) {
            firstBugType = 'red_orange_beetle';
            secondBugType = 'blue_beetle';
        } else {
            firstBugType = 'blue_beetle';
            secondBugType = 'red_orange_beetle';
        }
    }
};

// Preload images
const preload = {
    type: jsPsychPreload,
    images: ['red_bug.png', 'blue_bug.png', 'Pink.png', 'Orange.png', 'Yellow.png'],
    message: '<p>Loading resources...</p>'
};

// Phase transition messages
function createPhaseTransition(message) {
    return {
        type: jsPsychHtmlButtonResponse,
        stimulus: `<div style="background: #f5e6d3; padding: 50px; border-radius: 15px; box-shadow: 0 10px 40px rgba(139, 90, 43, 0.3);">
            <h2 style="font-family:Georgia, serif; color: #5d4037;">${message}</h2>
        </div>`,
        choices: ['Continue']
    };
}

// Create timeline
const timeline = [];

// Add initial screens
timeline.push(welcome_trial);
timeline.push(instructions);
timeline.push(initialize_bug_types);
timeline.push(preload);

// Function to check performance and advance phases
function checkPerformance() {
    const phaseData = jsPsych.data.get().filter({ phase: currentPhase }).values();
    
    // Phase 1 & 2: advance after 30 trials each (regardless of performance)
    if (currentPhase === 1 && phaseData.length >= 30) {
        currentPhase = 2;
        timeline.push(createPhaseTransition("A new bug has entered the tree!"));
        timeline.push(main_trial);
        return true;
    } else if (currentPhase === 2 && phaseData.length >= 30) {
        currentPhase = 3;
        timeline.push(createPhaseTransition("This tree now has both bugs!"));
        timeline.push(main_trial);
        return true;
    } else if (currentPhase === 3 && phaseData.length >= 30) {
        // Phase 3 complete (90 trials total)
        return false;
    }
    
    return false;
}

// Create main trial loop
const main_trial = {
    timeline: [
        {
            type: HMazePlugin,
            bug_type: function() {
                if (currentPhase === 1) return firstBugType;
                if (currentPhase === 2) return secondBugType;
                // Phase 3: randomly select between the two bug types
                return Math.random() < 0.5 ? firstBugType : secondBugType;
            },
            phase: function() { return currentPhase; },
            trial_number: function() {
                trialCount++;
                return trialCount;
            }
        }
    ],
    loop_function: function(data) {
        // Check if phase transition is needed
        if (checkPerformance()) {
            return false; // Stop current loop to show transition
        }
        
        // Check if experiment is complete (90 trials)
        if (trialCount >= 90) {
            return false; // End experiment
        }
        
        return true; // Continue trials
    }
};

// Add main trial loop
timeline.push(main_trial);

// End screen
timeline.push({
    type: jsPsychHtmlButtonResponse,
    stimulus: '<h1 style="font-family:serif;color:#5d4037">Thank You!</h1><p>The experiment is complete.</p>',
    choices: ['Finish']          // simple “Finish” button; no data download
});

// Run the experiment
jsPsych.run(timeline);