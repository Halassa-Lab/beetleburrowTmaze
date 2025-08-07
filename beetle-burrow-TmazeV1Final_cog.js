const jsPsych = initJsPsych({
    on_finish: function() {
        jsPsych.data.displayData('csv');
    }
});


let currentPhase = 1;
let trialCount = 0;
let firstBugType = null;
let secondBugType = null;

let audioContext;
let gainNode;
let biquadFilter;
let isAudioInitialized = false;


const predationProbabilities = {
    'red_orange_beetle': { 'Pink': 0.2, 'Orange': 0.8, 'Yellow': 0.5 },
    'blue_beetle': { 'Pink': 0.9, 'Orange': 0.3, 'Yellow': 0.6 }
};

const imageCache = {};
const imageSources = {
    red_bug: 'red_bug.png',
    blue_bug: 'blue_bug.png',
    Pink: 'Pink.png',
    Orange: 'Orange.png',
    Yellow: 'Yellow.png'
};

const TMazePlugin = (function(jspsych) {
    const info = {
        name: 'tmaze-task',
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

    class TMazePluginClass {
        constructor(jsPsych) {
            this.jsPsych = jsPsych;
        }

        trial(display_element, trial) {
            const plugin = this;
            
            let oscillator = null;
            let oscillatorStarted = false;
            let localGainNode = null;
            
            const canvas = document.createElement('canvas');
            canvas.width = 500;
            canvas.height = 500;
            canvas.style.cssText = 'border:4px solid #6d4c41;border-radius:15px;box-shadow:0 15px 50px rgba(0,0,0,0.3);background:#f5e6d3;cursor:pointer';
            display_element.appendChild(canvas);

            const ctx = canvas.getContext('2d'); 
            ctx.imageSmoothingEnabled = true; 

            const colors = {
                maze: '#4a3426',
                mazeHighlight: '#5d4037',
                background: '#faf8f5',
                pocketBase: 'rgba(205, 133, 63, 0.3)',
                text: '#3e2723',
                correctFeedback: '#689f38',
                incorrectFeedback: '#d84315'
            };

            const stemWidth = 40;
            const stemHeight = 100;
            const topHeight = 40;
            const leftArmLength = 150;
            const rightArmLength = 170;
            const topWidth = leftArmLength + stemWidth + rightArmLength;
            const mazeX = (canvas.width - topWidth) / 2 + leftArmLength;
            const mazeY = (canvas.height - stemHeight - topHeight) / 2;
            const junctionY = mazeY + stemHeight;
            const leftBoundary = (canvas.width - topWidth) / 2;
            const rightBoundary = leftBoundary + topWidth;
            const pocketRadius = 35;
            const pocketY = junctionY + topHeight;
            const leftPocketCenterX = mazeX - pocketRadius;
            const rightPocketCenterX = mazeX + stemWidth + pocketRadius;

            const mazeGradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
            mazeGradient.addColorStop(0, colors.mazeHighlight);
            mazeGradient.addColorStop(1, colors.maze);

            const predators = ['Pink', 'Orange', 'Yellow'];
            const leftIndex = Math.floor(Math.random() * 3);
            const leftPredator = predators[leftIndex];
            let rightIndex;
            do {
                rightIndex = Math.floor(Math.random() * 3);
            } while (rightIndex === leftIndex);
            const rightPredator = predators[rightIndex];

            const bug = {
                x: mazeX + (stemWidth / 2),
                y: mazeY,
                width: 30,
                height: 40,
                type: trial.bug_type,
                speed: 2,
                normalSpeed: 2,
                fastSpeed: 4,
                visible: true,
                direction: null,
                actualOutcome: null,
                isInDangerZone: false
            };

            let gameState = 'start';
            let animationId = null;
            let responseTimer = null;
            let startTime = null;
            let clickTime = null;

            const trial_data = {
                phase: trial.phase,
                trial: trial.trial_number,
                bug_type: trial.bug_type,
                left_predator: leftPredator,
                right_predator: rightPredator,
                bug_direction: null,
                actual_outcome: null,
                user_choice: null,
                correct: false,
                rt: null
            };

            const zones = {
                'escaped-left': { x: leftBoundary, y: junctionY, width: 60, height: topHeight },
                'eaten-left': { x: leftPocketCenterX - pocketRadius, y: pocketY - pocketRadius, width: pocketRadius * 2, height: pocketRadius * 2, isArc: true },
                'escaped-right': { x: rightBoundary - 60, y: junctionY, width: 60, height: topHeight },
                'eaten-right': { x: rightPocketCenterX - pocketRadius, y: pocketY - pocketRadius, width: pocketRadius * 2, height: pocketRadius * 2, isArc: true }
            };

            function drawTMaze() {
                ctx.fillStyle = mazeGradient;
                ctx.fillRect(mazeX, mazeY, stemWidth, stemHeight);
                ctx.fillRect(leftBoundary, junctionY, topWidth, topHeight);
            }

            function drawPredatorPockets() {
                const drawPocket = (centerX, predatorName) => {
                    ctx.fillStyle = 'rgba(205, 133, 63, 0.4)';
                    ctx.beginPath();
                    ctx.arc(centerX, pocketY, pocketRadius, 0, Math.PI, false);
                    ctx.fill();
                    ctx.strokeStyle = 'rgba(139, 90, 43, 0.5)';
                    ctx.lineWidth = 2;
                    ctx.stroke();

                    const img = imageCache[predatorName];
                    if (img && img.complete) {
                        const h = 33;
                        const w = h * (2 / 3);
                        ctx.drawImage(img, centerX - w / 2, pocketY + 2, w, h);
                    }
                };

                drawPocket(leftPocketCenterX, leftPredator);
                drawPocket(rightPocketCenterX, rightPredator);
            }

            function playTone() {
                if (!isAudioInitialized) return;
                
                stopTone();
                
                try {
                    oscillator = audioContext.createOscillator();
                    oscillator.type = 'sawtooth';
                    
                    localGainNode = audioContext.createGain();
                    localGainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
                    
                    oscillator.connect(biquadFilter);
                    biquadFilter.connect(localGainNode);
                    localGainNode.connect(audioContext.destination);
                    
                    oscillator.start();
                    oscillatorStarted = true;
                    
                    updateAudio();
                } catch(e) {
                    console.warn('Audio failed:', e);
                }
            }

            function stopTone() {
                if (oscillator) {
                    try {
                        if (oscillatorStarted) oscillator.stop();
                        oscillator.disconnect();
                    } catch(e) {}
                    oscillator = null;
                    oscillatorStarted = false;
                }
                
                if (localGainNode) {
                    try {
                        localGainNode.disconnect();
                    } catch(e) {}
                    localGainNode = null;
                }
                
                if (biquadFilter) {
                    try {
                        biquadFilter.disconnect();
                    } catch(e) {}
                    biquadFilter = audioContext.createBiquadFilter();
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
                if (!bug.visible) return;
                
                const img = imageCache[bug.type === 'red_orange_beetle' ? 'red_bug' : 'blue_bug'];
                if (img && img.complete) {
                    ctx.drawImage(img, bug.x - bug.width / 2, bug.y - bug.height / 2, bug.width, bug.height);
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
                    ctx.fillText('What was the outcome? Click the area.', canvas.width / 2, mazeY - 30);
                    
                    ctx.save();
                    ctx.globalAlpha = 0.35;
                    
                    ctx.fillStyle = '#3498db';
                    ctx.fillRect(leftBoundary, junctionY, 60, topHeight);
                    ctx.fillRect(rightBoundary - 60, junctionY, 60, topHeight);
                    
                    ctx.fillStyle = '#e74c3c';
                    ctx.beginPath();
                    ctx.arc(leftPocketCenterX, pocketY, pocketRadius, 0, Math.PI, false);
                    ctx.fill();
                    ctx.beginPath();
                    ctx.arc(rightPocketCenterX, pocketY, pocketRadius, 0, Math.PI, false);
                    ctx.fill();
                    
                    ctx.restore();
                }
            }

            function drawFeedback() {
                ctx.font = '700 24px serif';
                ctx.textAlign = 'center';
                ctx.fillStyle = trial_data.correct ? colors.correctFeedback : colors.incorrectFeedback;
                ctx.fillText(trial_data.correct ? 'Correct!' : 'Incorrect!', canvas.width / 2, mazeY - 30);

                const correctZone = zones[bug.actualOutcome];
                if (correctZone) {
                    ctx.save();
                    ctx.globalAlpha = 0.5;
                    ctx.fillStyle = colors.correctFeedback;

                    if (correctZone.isArc) {
                        ctx.beginPath();
                        ctx.arc(correctZone.x + pocketRadius, correctZone.y + pocketRadius, pocketRadius, 0, Math.PI, false);
                        ctx.fill();
                    } else {
                        ctx.fillRect(correctZone.x, correctZone.y, correctZone.width, correctZone.height);
                    }
                    ctx.restore();
                }
            }

            function update() {
                if (gameState !== 'running') return;

                if (bug.direction === null) {
                    if (bug.y < junctionY + topHeight / 2) {
                        bug.y += bug.speed;
                    } else {
                        bug.y = junctionY + topHeight / 2;
                        bug.visible = false;
                        bug.direction = Math.random() < 0.5 ? 'left' : 'right';
                        
                        const predator = bug.direction === 'left' ? leftPredator : rightPredator;
                        const probability = predationProbabilities[bug.type][predator];
                        
                        bug.actualOutcome = Math.random() < probability ? 
                            `eaten-${bug.direction}` : `escaped-${bug.direction}`;
                        
                        trial_data.bug_direction = bug.direction;
                        trial_data.actual_outcome = bug.actualOutcome;
                    }
                } else {
                    const wasInDangerZone = bug.isInDangerZone;
                    
                    if (bug.direction === 'left') {
                        bug.isInDangerZone = bug.x < leftPocketCenterX + pocketRadius && 
                                           bug.x > leftPocketCenterX - pocketRadius;
                    } else {
                        bug.isInDangerZone = bug.x > rightPocketCenterX - pocketRadius && 
                                           bug.x < rightPocketCenterX + pocketRadius;
                    }

                    if (wasInDangerZone !== bug.isInDangerZone) {
                        bug.speed = bug.isInDangerZone ? bug.fastSpeed : bug.normalSpeed;
                        updateAudio();
                    }

                    bug.x += (bug.direction === 'left' ? -1 : 1) * bug.speed;

                    if (bug.actualOutcome.startsWith('eaten')) {
                        const stopX = bug.direction === 'left' ? leftPocketCenterX : rightPocketCenterX;
                        if ((bug.direction === 'left' && bug.x <= stopX) || 
                            (bug.direction === 'right' && bug.x >= stopX)) {
                            bug.x = stopX;
                            endTrial();
                        }
                    } else if (bug.x < leftBoundary || bug.x > rightBoundary) {
                        endTrial();
                    }
                }
            }

            function endTrial() {
                stopTone();
                gameState = 'awaitingInput';
                clickTime = performance.now();
                
                responseTimer = setTimeout(() => {
                    if (gameState === 'awaitingInput') {
                        trial_data.user_choice = 'miss';
                        trial_data.correct = false;
                        trial_data.rt = trial.response_time_limit;
                        
                        gameState = 'feedback';
                        render();
                        
                        setTimeout(finishTrial, 1500);
                    }
                }, trial.response_time_limit);
            }

            function render() {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                drawTMaze();
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
                    for (const [outcome, zone] of Object.entries(zones)) {
                        if (x >= zone.x && x <= zone.x + zone.width && 
                            y >= zone.y && y <= zone.y + zone.height) {
                            clearTimeout(responseTimer);
                            
                            trial_data.user_choice = outcome;
                            trial_data.correct = (outcome === bug.actualOutcome);
                            trial_data.rt = performance.now() - clickTime;
                            
                            gameState = 'feedback';
                            render();
                            
                            setTimeout(finishTrial, 1500);
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
            };

            canvas.addEventListener('click', handleClick);
            render();
        }
    }

    TMazePluginClass.info = info;
    return TMazePluginClass;
})(jsPsych);

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

function loadImageCache() {
    for (const [key, src] of Object.entries(imageSources)) {
        const img = new Image();
        img.src = src;
        imageCache[key] = img;
    }
}

// Welcome screen
const welcome_trial = {
    type: jsPsychHtmlButtonResponse,
    stimulus: '<h1 style="font-family:Georgia, serif;color:#5d4037">Halassa Lab\'s Beetle Burrow T-Maze</h1><p style="font-family:Georgia, serif;font-size:18px">Welcome to the experiment!</p>',
    choices: ['Begin'],
    on_finish: function() {
        setupAudio();
        loadImageCache();
    }
};

// Instructions
const instructions = {
    type: jsPsychInstructions,
    pages: [
        `<div style="background:#f5e6d3;padding:50px;border-radius:20px;max-width:800px;margin:auto">
            <h1 style="font-family:Georgia, serif;color:#5d4037">Instructions</h1>
            <p><strong>Goal:</strong> Predict the outcome of a beetle's journey through a tree trunk.</p>
            <p><strong>How it works:</strong></p>
            <ul style="text-align:left">
                <li>A beetle is burrowing through a tree and is invisible from view</li>
                <li>The beetle makes an audible noise as it moves.  The noise increases in frequency when the beetle speeds up.</li>
                <li>The tree is filled with pockets where predators are hiding.  The predators have specific preferences for the different beetles.</li>
                <li>The beetle will either be <strong>eaten</strong> or <strong>escape</strong> depending on the predators it comes across on its path to the exit.</li>
                <li>Click where you think the beetle ended up: either eaten at one of the pockets or escaped through one of the exits.</li>
                <li>You'll receive immediate feedback.</li>
            </ul>
            <p>Learn the predator preferences by observing beetle types and their outcomes!</p>
        </div>`
    ],
    show_clickable_nav: true,
    button_label_previous: 'Back',
    button_label_next: 'Begin'
};

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


const preload = {
    type: jsPsychPreload,
    images: Object.values(imageSources),
    message: '<p>Loading resources...</p>'
};


function createPhaseTransition(message) {
    return {
        type: jsPsychHtmlButtonResponse,
        stimulus: `<div style="background:#f5e6d3;padding:50px;border-radius:15px;box-shadow:0 10px 40px rgba(139,90,43,0.3)">
            <h2 style="font-family:serif;color:#5d4037">${message}</h2>
        </div>`,
        choices: ['Continue']
    };
}


const timeline = [];

timeline.push(welcome_trial);
timeline.push(instructions);
timeline.push(initialize_bug_types);
timeline.push(preload);


const phase1_trials = {
    timeline: [
        {
            type: TMazePlugin,
            bug_type: function() { return firstBugType; },
            phase: 1,
            trial_number: function() { return ++trialCount; }
        }
    ],
    loop_function: function() {
        const phaseData = jsPsych.data.get().filter({phase: 1}).values();
        if (phaseData.length >= 10) {
            const last10 = phaseData.slice(-10);
            const correct = last10.filter(t => t.correct).length;
            if (correct >= 6) {
                currentPhase = 2;
                return false;
            }
        }
        return true;
    }
};


const phase2_transition = createPhaseTransition("A new bug has entered the tree!");
const phase2_trials = {
    timeline: [
        {
            type: TMazePlugin,
            bug_type: function() { return secondBugType; },
            phase: 2,
            trial_number: function() { return ++trialCount; }
        }
    ],
    conditional_function: function() { return currentPhase === 2; },
    loop_function: function() {
        const phaseData = jsPsych.data.get().filter({phase: 2}).values();
        if (phaseData.length >= 10) {
            const last10 = phaseData.slice(-10);
            const correct = last10.filter(t => t.correct).length;
            if (correct >= 6) {
                currentPhase = 3;
                return false;
            }
        }
        return true;
    }
};


const phase3_transition = createPhaseTransition("This tree now has both bugs!");
const phase3_trials = {
    timeline: [
        {
            type: TMazePlugin,
            bug_type: function() { 
                return Math.random() < 0.5 ? firstBugType : secondBugType;
            },
            phase: 3,
            trial_number: function() { return ++trialCount; }
        }
    ],
    conditional_function: function() { return currentPhase === 3; },
    loop_function: function() {
        const phaseData = jsPsych.data.get().filter({phase: 3}).values();
        if (phaseData.length >= 10) {
            const last10 = phaseData.slice(-10);
            const correct = last10.filter(t => t.correct).length;
            if (correct >= 6) {
                currentPhase = 4;
                return false;
            }
        }
        return true;
    }
};

const phase4_transition = createPhaseTransition("Training complete – full run!");
const phase4_trials = {
    timeline: [
        {
            type: TMazePlugin,
            bug_type: function() { 
                return Math.random() < 0.5 ? 'red_orange_beetle' : 'blue_beetle';
            },
            phase: 4,
            trial_number: function() { return ++trialCount; }
        }
    ],
    conditional_function: function() { return currentPhase === 4; },
    loop_function: function() {
        const phaseData = jsPsych.data.get().filter({phase: 4}).values();
        return phaseData.length < 40;
    }
};

timeline.push(phase1_trials);
timeline.push({
    timeline: [phase2_transition],
    conditional_function: function() { return currentPhase === 2; }
});
timeline.push(phase2_trials);
timeline.push({
    timeline: [phase3_transition],
    conditional_function: function() { return currentPhase === 3; }
});
timeline.push(phase3_trials);
timeline.push({
    timeline: [phase4_transition],
    conditional_function: function() { return currentPhase === 4; }
});
timeline.push(phase4_trials);

timeline.push({
    type: jsPsychHtmlButtonResponse,
    stimulus: '<h1 style="font-family:serif;color:#5d4037">Thank You!</h1><p>The experiment is complete.</p>',
    choices: ['Finish']          
});

jsPsych.run(timeline);