const jsPsych = initJsPsych({
    on_finish: function() {
        jsPsych.data.displayData('csv');
    }
});

const subject_id = jsPsych.randomization.randomID(8);
jsPsych.data.addProperties({
    subject_id: subject_id
});

let currentPhase = 1;
let trialCount = 0;
let firstBugType = null;
let secondBugType = null;

let audioContext;
let gainNode;
let biquadFilter;
let lfAudioBuffer = null; 
let hfAudioBuffer = null;  
let isAudioInitialized = false;

// Predation probabilities
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
const HF_GAIN = 1.0;   
const LF_GAIN = 1.0;   

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
            },
             is_demo: {
                type: 'BOOL',
                pretty_name: 'Is Demo',
                default: false
            },
            demo_outcome: {
                type: 'STRING',
                pretty_name: 'Demo Outcome',
                default: null
            },
            demo_text: {
                type: 'STRING',
                pretty_name: 'Demo Text',
                default: null
            },
            demo_visible_bug: {
                type: 'BOOL',
                pretty_name: 'Demo Visible Bug',
                default: false
            }
        }
    };

    class TMazePluginClass {
        constructor(jsPsych) {
            this.jsPsych = jsPsych;
        }

        trial(display_element, trial) {
            const plugin = this;
            
            let pulseStarted    = false;
            let lfSource = null;
            let hfSource = null;
            let lfGain   = null;
            let hfGain   = null;
            
            const canvas = document.createElement('canvas');
            canvas.width = 500;
            canvas.height = 500;
            canvas.style.cssText = 'border:4px solid #6d4c41;border-radius:15px;box-shadow:0 15px 50px rgba(0,0,0,0.3);background:#f5e6d3;cursor:pointer';
            display_element.appendChild(canvas);

            const ctx = canvas.getContext('2d'); 
            ctx.imageSmoothingEnabled = true; 

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

            // Bug setup
            const bug = {
                x: mazeX + (stemWidth / 2),
                y: mazeY,
                width: 30,
                height: 40,
                type: trial.bug_type,
                speed: 2,
                normalSpeed: 2,
                fastSpeed: 10,
                visible: true,
                direction: null,
                actualOutcome: null,
                isInDangerZone: false,
                isFading: false,
                alpha: 1.0  
            };

            // Game state
            let gameState = 'start';
            let animationId = null;
            let responseTimer = null;
            let startTime = null;
            let clickTime = null;
            let horizontalStartTime = null; 

            // Trial data
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
                response_time: null,
                time_vertical_movement: null,   
                time_horizontal_movement: null 
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

            function playPulse() {
                if (!isAudioInitialized || !lfAudioBuffer || !hfAudioBuffer) return;
                
                stopPulse();
                
                lfSource = audioContext.createBufferSource();
                hfSource = audioContext.createBufferSource();
                
                lfSource.buffer = lfAudioBuffer;
                hfSource.buffer = hfAudioBuffer;
                lfSource.loop   = true;
                hfSource.loop   = true;
                
                lfGain = audioContext.createGain();
                hfGain = audioContext.createGain();
                lfGain.gain.setValueAtTime(LF_GAIN, audioContext.currentTime); 
                hfGain.gain.setValueAtTime(0.0,     audioContext.currentTime);  
                
                lfSource.connect(lfGain).connect(audioContext.destination);
                hfSource.connect(hfGain).connect(audioContext.destination);
                
                lfSource.start();
                hfSource.start();
                pulseStarted = true;  
            }

            function stopPulse () {
                [lfSource, hfSource].forEach(src => {
                    if (src) { try { src.stop(); src.disconnect(); } catch(e){} }
                });
                lfSource = hfSource = null;
                lfGain   = hfGain   = null;
                pulseStarted = false;
                }


            function updateAudio() {
                if (!isAudioInitialized || !lfSource || !hfSource) return;

                const rate = bug.speed === bug.fastSpeed ? 2.0 : 1.0;
                lfSource.playbackRate.value = rate;
                hfSource.playbackRate.value = rate;

                const now = audioContext.currentTime;
                if (bug.isInDangerZone) {
                    hfGain.gain.setTargetAtTime(HF_GAIN, now, 0.05); 
                    lfGain.gain.setTargetAtTime(0.0,    now, 0.05); 
                } else {
                    hfGain.gain.setTargetAtTime(0.0,    now, 0.05);
                    lfGain.gain.setTargetAtTime(LF_GAIN,now, 0.05);
                }
                }


            function drawBug() {
                if (!bug.visible) return;

                const img = imageCache[bug.type === 'red_orange_beetle' ? 'red_bug' : 'blue_bug'];
                if (!img || !img.complete) return;

                ctx.save(); 

                ctx.globalAlpha = bug.alpha;

                const shouldRotate = trial.demo_visible_bug && bug.direction !== null;

                if (shouldRotate) {
                    ctx.translate(bug.x, bug.y);
                    let angle = 0;
                    if (bug.direction === 'left') { angle = Math.PI / 2; } 
                    else if (bug.direction === 'right') { angle = -Math.PI / 2; }
                    ctx.rotate(angle);
                    ctx.drawImage(img, -bug.width / 2, -bug.height / 2, bug.width, bug.height);
                } else {
                    ctx.drawImage(img, bug.x - bug.width / 2, bug.y - bug.height / 2, bug.width, bug.height);
                }

                ctx.restore(); 
            }

            function drawUI() {
                ctx.fillStyle = colors.text;
                ctx.font = '600 16px Georgia, serif';
                ctx.textAlign = 'left';
                ctx.fillText(`Trial: ${trial.trial_number} (Phase: ${trial.phase})`, 20, 30);

                if (gameState === 'start') {
                    ctx.font = '700 24px Georgia, serif';
                    ctx.textAlign = 'center';
                    ctx.fillText('Click to Start', canvas.width / 2, canvas.height / 5);
                } else if (gameState === 'awaitingInput' && !trial.is_demo) {
                    ctx.font = '600 18px Georgia, serif';
                    ctx.textAlign = 'center';
                    ctx.fillText('What was the outcome? Click the area.', canvas.width / 2, mazeY - 30);

                    ctx.save();
                    ctx.globalAlpha = 0.35;
                    
                    ctx.fillStyle = '#808080'; 
                    
                    ctx.fillRect(leftBoundary, junctionY, 60, topHeight);
                    ctx.fillRect(rightBoundary - 60, junctionY, 60, topHeight);
                    
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

                const drawHighlight = (zone, color) => {
                    if (!zone) return;
                    ctx.save();
                    ctx.globalAlpha = 0.5;
                    ctx.fillStyle = color;
                    if (zone.isArc) {
                        ctx.beginPath();
                        ctx.arc(zone.x + pocketRadius, zone.y + pocketRadius, pocketRadius, 0, Math.PI, false);
                        ctx.fill();
                    } else {
                        ctx.fillRect(zone.x, zone.y, zone.width, zone.height);
                    }
                    ctx.restore();
                };
                if (trial.is_demo) {
                    ctx.fillStyle = colors.text;

                    const lines = trial.demo_text.split('\n');
                    const lineHeight = 22;                        // pixels between lines
                    const startY = mazeY - 30 - (lines.length - 1) * lineHeight / 2;

                    lines.forEach((line, i) => {
                        ctx.fillText(line.trim(), canvas.width / 2, startY + i * lineHeight);
                    });

                    drawHighlight(zones[bug.actualOutcome], '#3498db');
                    return;
                    }
                if (trial_data.user_choice === 'miss') {
                    ctx.fillStyle = 'orange';
                    ctx.fillText('Miss!', canvas.width / 2, mazeY - 30);
                } else if (trial_data.correct) {
                    ctx.fillStyle = colors.correctFeedback;
                    ctx.fillText('Correct!', canvas.width / 2, mazeY - 30);
                    drawHighlight(zones[bug.actualOutcome], colors.correctFeedback);
                } else {
                    ctx.fillStyle = colors.incorrectFeedback;
                    ctx.fillText('Incorrect!', canvas.width / 2, mazeY - 30);
                    drawHighlight(zones[trial_data.user_choice], colors.incorrectFeedback);
                    drawHighlight(zones[bug.actualOutcome], '#3498db');
                }
            }

            function update() {
                if (gameState !== 'running') return;

                if (!bug.isFading) {
                    if (bug.direction === null) {
                        if (bug.y < junctionY + topHeight / 2) {
                            bug.y += bug.speed;
                        } else {
                            bug.y = junctionY + topHeight / 2;
                            
                            if (!trial.demo_visible_bug) {
                                bug.visible = false;
                            }
                            
                            trial_data.time_vertical_movement = performance.now() - startTime;
                            horizontalStartTime = performance.now();
                            
                            if (trial.is_demo) {
                                bug.direction = trial.demo_outcome.endsWith('left') ? 'left' : 'right';
                                bug.actualOutcome = trial.demo_outcome;
                            } else {
                                bug.direction = Math.random() < 0.5 ? 'left' : 'right';
                                const predator = bug.direction === 'left' ? leftPredator : rightPredator;
                                const probability = predationProbabilities[bug.type][predator];
                                bug.actualOutcome = Math.random() < probability ?
                                    `eaten-${bug.direction}` : `escaped-${bug.direction}`;
                            }
                            
                            trial_data.bug_direction = bug.direction;
                            trial_data.actual_outcome = bug.actualOutcome;
                        }
                    } else {
                        if (bug.speed > 0) {
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
                        }

                        if (bug.actualOutcome.startsWith('eaten')) {
                            const stopX = bug.direction === 'left' ? leftPocketCenterX : rightPocketCenterX;
                            if ((bug.direction === 'left' && bug.x <= stopX) || 
                                (bug.direction === 'right' && bug.x >= stopX)) {
                                
                                bug.x = stopX;      
                                bug.speed = 0;      
                                updateAudio();      

                                if (trial.demo_visible_bug) {
                                    bug.isFading = true;
                                } else {
                                    endTrial();
                                    return;
                                }
                            }
                        } else if (bug.x < leftBoundary || bug.x > rightBoundary) {
                            endTrial();
                            return; 
                        }
                    }
                }

                if (bug.isFading) {
                    bug.alpha -= 0.04; 
                    if (bug.alpha <= 0) {
                        bug.alpha = 0;
                        bug.visible = false;
                        endTrial(); 
                    }
                }
            }

            function endTrial() {
                stopPulse();
                if (horizontalStartTime) {
                    trial_data.time_horizontal_movement = performance.now() - horizontalStartTime;
                }
                
                if (trial.is_demo) {
                    gameState = 'feedback';
                    render();
                    setTimeout(finishTrial, 4000); 
                } else {
                    gameState = 'awaitingInput';
                    clickTime = performance.now();
                    
                    responseTimer = setTimeout(() => {
                        if (gameState === 'awaitingInput') {
                            trial_data.user_choice = 'miss';
                            trial_data.correct = false;
                            trial_data.response_time = trial.response_time_limit;
                            
                            gameState = 'feedback';
                            render();
                            
                            setTimeout(finishTrial, 1500);
                        }
                    }, trial.response_time_limit);
                }
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
                    playPulse();
                    
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
                            trial_data.response_time = performance.now() - clickTime;
                            
                            gameState = 'feedback';
                            render();
                            
                            setTimeout(finishTrial, 1500);
                            break;
                        }
                    }
                }
            }

            const finishTrial = () => {
                stopPulse();
                
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

async function setupAudio() {
  if (isAudioInitialized) return;
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') await audioContext.resume();

    gainNode      = audioContext.createGain();
    biquadFilter  = audioContext.createBiquadFilter();
    gainNode.gain.setValueAtTime(0.6, audioContext.currentTime);

    const [lfArr, hfArr] = await Promise.all([
      fetch('LF.wav').then(r => r.arrayBuffer()),
      fetch('HF.wav').then(r => r.arrayBuffer())
    ]);

    lfAudioBuffer = await audioContext.decodeAudioData(lfArr);
    hfAudioBuffer = await audioContext.decodeAudioData(hfArr);

    isAudioInitialized = true;
  } catch (e) {
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
                <li>The beetle makes an audible noise as it moves.  The beetle speeds up when it is near a predator and thus the noise increases in frequency.</li>
                <li>The tree is filled with pockets where predators are hiding.  The predators have specific preferences for the different beetles.</li>
                <li>The beetle will either be <strong>eaten</strong> or <strong>escape</strong> depending on the predators it comes across on its path to the exit.</li>
                <li>Click where you think the beetle ended up: either eaten at one of the pockets or escaped through one of the exits.</li>
                <li>You'll receive immediate feedback.  It is recommended to wear headphones!</li>
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
            <h2 style="font-family:Georgia, serif;color:#5d4037">${message}</h2>
        </div>`,
        choices: ['Continue']
    };
}

// Create timeline
const timeline = [];

const demographics_trial = {
    type: jsPsychSurveyHtmlForm,
    preamble: '<h2 style="font-family:Georgia, serif;color:#5d4037">Participant Information</h2><p>Please provide the following information before beginning.</p>',
    html: `
        <div style="text-align: left; max-width: 400px; margin: auto;">
            <p style="margin-bottom: 15px;">
                <label for="age" style="display: block; margin-bottom: 5px;">Age:</label>
                <input type="number" name="age" id="age" required style="width: 100px; padding: 5px;" />
            </p>
            <p>
                <span style="display: block; margin-bottom: 5px;">Sex:</span>
                <input type="radio" name="sex" value="male" id="male" required> <label for="male">Male</label><br>
                <input type="radio" name="sex" value="female" id="female"> <label for="female">Female</label><br>
                <input type="radio" name="sex" value="prefer_not_to_say" id="pnts"> <label for="pnts">Prefer not to say</label>
            </p>
        </div>`,
    button_label: 'Continue',
    on_finish: function(data) {
        jsPsych.data.addProperties({
            age: data.response.age,
            sex: data.response.sex
        });
    }
};


timeline.push(welcome_trial);
timeline.push(demographics_trial);
timeline.push(instructions);

const demo_trial_visible_eaten = {
    type: TMazePlugin,
    is_demo: true,
    demo_visible_bug: true, 
    bug_type: 'red_orange_beetle',
    demo_outcome: 'eaten-right',
    demo_text: 'The beetle got eaten!',
    trial_number: 'Demo 1',
    phase: 0
};

const demo_trial_visible_escaped = {
    type: TMazePlugin,
    is_demo: true,
    demo_visible_bug: true, 
    bug_type: 'blue_beetle',
    demo_outcome: 'escaped-left',
    demo_text: 'The beetle escaped!',
    trial_number: 'Demo 2',
    phase: 0
};

const demo_trial_eaten = {
    type: TMazePlugin,
    is_demo: true,
    bug_type: 'red_orange_beetle',
    demo_outcome: 'eaten-right',
    demo_text: 'The beetle was eaten by the predator.\nTone ended during predator encounter!',
    trial_number: 'Demo 3',
    phase: 0
};

const demo_trial_escaped = {
    type: TMazePlugin,
    is_demo: true,
    bug_type: 'blue_beetle',
    demo_outcome: 'escaped-left',
    demo_text: 'The beetle escaped through the exit.\nTone continues after the predator encounter!',
    trial_number: 'Demo 4',
    phase: 0
};

const demo_trial_escaped_2 = {
    type: TMazePlugin,
    is_demo: true,
    bug_type: 'red_orange_beetle',
    demo_outcome: 'escaped-right',
    demo_text: 'The beetle escaped through the exit.\nLonger tone due to longer arm length!',
    trial_number: 'Demo 5',
    phase: 0
};

const demo_trial_eaten_2 = {
    type: TMazePlugin,
    is_demo: true,
    bug_type: 'blue_beetle',
    demo_outcome: 'eaten-left',
    demo_text: 'The beetle was eaten by the predator.',
    trial_number: 'Demo 6',
    phase: 0
};

const demo_loop = {
    timeline: [
        {
            type: jsPsychHtmlButtonResponse,
            stimulus: '<h2 style="font-family:Georgia, serif;color:#5d4037">Let\'s watch the beetle move.</h2><p>You will see two examples of a beetle navigating. You do not need to respond.  Pay attention to the sound, movement and the outcome of the beetle.</p>',
            choices: ['Watch']
        },
        demo_trial_visible_eaten,
        demo_trial_visible_escaped,
        {
            type: jsPsychHtmlButtonResponse,
            stimulus: '<h2 style="font-family:Georgia, serif;color:#5d4037">Full Task Demo</h2><p>The beetle has burrowed into the tree, hidden from view as it will be in the task.  Listen to the noises to figure out what is happening.</p>',
            choices: ['Watch']
        },
        demo_trial_eaten,
        demo_trial_escaped,
        demo_trial_escaped_2,
        demo_trial_eaten_2,
        {
            type: jsPsychHtmlButtonResponse,
            stimulus: '<h2 style="font-family:Georgia, serif;color:#5d4037">Demo Finished</h2>',
            choices: ['Repeat Demo', 'Proceed to Task'],
            prompt: '<p>Would you like to see the demo again or start the experiment?</p>'
        }
    ],
    loop_function: function(data) {
        if (data.values().slice(-1)[0].response === 0) {
            return true; 
        } else {
            return false;
        }
    }
};

timeline.push(demo_loop);

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

        if (phaseData.length < 10) {
            return true; 
        }

        const last10 = phaseData.slice(-10);
        const correct = last10.filter(t => t.correct).length;

        if (correct >= 8 && phaseData.length >= 20) {
            currentPhase = 2;
            return false; 
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

        if (phaseData.length < 10) {
            return true; 
        }

        const last10 = phaseData.slice(-10);
        const correct = last10.filter(t => t.correct).length;

        if (correct >= 8 && phaseData.length >= 20) {
            currentPhase = 3; 
            return false; 
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

        if (phaseData.length < 10) {
            return true; 
        }

        const last10 = phaseData.slice(-10);
        const correct = last10.filter(t => t.correct).length;

        if (correct >= 8 && phaseData.length >= 20) {
            currentPhase = 4; 
            return false; 
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
        return phaseData.length < 80;
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
    stimulus: '<h1 style="font-family:Georgia, serif;color:#5d4037">Thank You!</h1><p>The experiment is complete.</p>',
    choices: ['Finish']        
});

jsPsych.run(timeline);