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
let phaseTransitionPending = false;

// Audio components - FIXED: Removed global oscillator variable
let audioContext;
let gainNode;
let biquadFilter;
let isAudioInitialized = false;

// Predation probabilities
const predationProbabilities = {
    'red_orange_beetle': { 'Pink': 0.2, 'Orange': 0.8, 'Yellow': 0.5 },
    'blue_beetle': { 'Pink': 0.9, 'Orange': 0.3, 'Yellow': 0.6 }
};

// Create custom plugin for the T-Maze task
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
            const plugin = this; // Store reference to plugin instance
            
            // FIXED: Create local oscillator variable for this trial only
            let oscillator = null;
            let oscillatorStarted = false;
            
            // Create and load image objects for use in the canvas
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
            canvas.width = 500;
            canvas.height = 500;
            canvas.style.border = '4px solid #6d4c41';
            canvas.style.borderRadius = '15px';
            canvas.style.boxShadow = '0 15px 50px rgba(0, 0, 0, 0.3)';
            canvas.style.background = '#faf8f5';
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

            // Maze dimensions
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

            // Predator setup
            const predators = ['Pink', 'Orange', 'Yellow'];
            const leftPredator = predators[Math.floor(Math.random() * predators.length)];
            let rightPredator;
            do {
                rightPredator = predators[Math.floor(Math.random() * predators.length)];
            } while (rightPredator === leftPredator);

            // Pocket positions
            const pocketRadius = 35;
            const pocketY = junctionY + topHeight;
            const leftPocketCenterX = mazeX - pocketRadius;
            const rightPocketCenterX = mazeX + stemWidth + pocketRadius;

            // Bug setup
            let bug = {
                x: mazeX + (stemWidth / 2),
                y: mazeY,
                width: 30, // Adjust width as needed for your image
                height: 40, // Adjust height as needed for your image
                type: trial.bug_type,
                speed: 2,
                normalSpeed: 2,
                fastSpeed: 3.5,
                visible: true,
                direction: null,
                actualOutcome: null,
                isInDangerZone: false 
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
                left_predator: leftPredator,
                right_predator: rightPredator,
                bug_direction: null,
                actual_outcome: null,
                user_choice: null,
                correct: false,
                rt: null
            };

            // Drawing functions
            function drawTMaze() {
                ctx.save();
                const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
                gradient.addColorStop(0, colors.mazeHighlight);
                gradient.addColorStop(1, colors.maze);
                ctx.fillStyle = gradient;
                ctx.fillRect(mazeX, mazeY, stemWidth, stemHeight);
                ctx.fillRect(leftBoundary, junctionY, topWidth, topHeight);
                ctx.restore();
            }

            function drawPredatorPockets() {
                const drawPocket = (centerX, predatorName) => {
                    const gradient = ctx.createRadialGradient(centerX, pocketY, 0, centerX, pocketY, pocketRadius);
                    gradient.addColorStop(0, 'rgba(205, 133, 63, 0.4)');
                    gradient.addColorStop(1, 'rgba(139, 90, 43, 0.2)');
                    ctx.fillStyle = gradient;
                    ctx.beginPath();
                    ctx.arc(centerX, pocketY, pocketRadius, 0, Math.PI, false);
                    ctx.fill();
                    ctx.strokeStyle = 'rgba(139, 90, 43, 0.5)';
                    ctx.lineWidth = 2;
                    ctx.stroke();

                    // Draw predator image instead of text
                    const predatorImage = images[predatorName];
                    const predatorImgHeight = 33; // Set the image height
                    const predatorImgWidth = predatorImgHeight * (2 / 3); // Calculate width for a 2:3 ratio

                    if (predatorImage) {
                        // Center the image horizontally
                        const predatorX = centerX - predatorImgWidth / 2;
                        // Position the image vertically to sit inside the pocket
                        const predatorY = pocketY + 2; 

                        ctx.drawImage(
                            predatorImage,
                            predatorX,
                            predatorY,
                            predatorImgWidth,
                            predatorImgHeight
                        );
                    }
                };

                drawPocket(leftPocketCenterX, leftPredator);
                drawPocket(rightPocketCenterX, rightPredator);
            }
            
            // FIXED: Complete rewrite of audio functions with proper cleanup
            function playTone() {
                if (!isAudioInitialized) return;
                
                // Clean up any existing oscillator first
                stopTone();
                
                try {
                    // Create a fresh oscillator
                    oscillator = audioContext.createOscillator();
                    oscillator.type = 'sawtooth';
                    
                    // Create a new gain node for this oscillator to ensure clean disconnection
                    const localGain = audioContext.createGain();
                    localGain.gain.setValueAtTime(0.1, audioContext.currentTime);
                    
                    // Connect: oscillator -> biquadFilter -> localGain -> destination
                    oscillator.connect(biquadFilter);
                    biquadFilter.connect(localGain);
                    localGain.connect(audioContext.destination);
                    
                    oscillator.start();
                    oscillatorStarted = true;
                    
                    // Store the local gain node so we can disconnect it later
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
                    } catch(e) {
                        // Oscillator might already be stopped
                    }
                    
                    try {
                        oscillator.disconnect();
                        if (oscillator.localGain) {
                            oscillator.localGain.disconnect();
                        }
                    } catch(e) {
                        // Already disconnected
                    }
                    
                    oscillator = null;
                    oscillatorStarted = false;
                }
                
                // FIXED: Also disconnect and recreate the biquad filter to ensure clean state
                if (biquadFilter) {
                    try {
                        biquadFilter.disconnect();
                    } catch(e) {}
                    
                    // Recreate the biquad filter for the next trial
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
                } catch(e) {
                    // Oscillator might have been stopped
                }
            }

            // Updated to draw the bug image
            function drawBug() {
                if (bug.visible) {
                    const bugImage = (bug.type === 'red_orange_beetle') ? images.red_bug : images.blue_bug;
                    if (bugImage && bugImage.complete) { // Check if image has loaded
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
                    ctx.fillText('What was the outcome? Click the area.', canvas.width / 2, mazeY - 30);
                    
                    // Highlight clickable zones
                    ctx.save();
                    ctx.globalAlpha = 0.35;
                    
                    // Exit zones
                    ctx.fillStyle = '#3498db';
                    ctx.fillRect(leftBoundary, junctionY, 60, topHeight);
                    ctx.fillRect(rightBoundary - 60, junctionY, 60, topHeight);
                    
                    // Pocket zones
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
                // Draw the 'Correct!' or 'Incorrect!' text
                ctx.font = '700 24px serif';
                ctx.textAlign = 'center';
                ctx.fillStyle = trial_data.correct ? colors.correctFeedback : colors.incorrectFeedback;
                ctx.fillText(trial_data.correct ? 'Correct!' : 'Incorrect!', canvas.width / 2, mazeY - 30);

                // Define the zones again for drawing
                const zones = {
                    'escaped-left': { x: leftBoundary, y: junctionY, width: 60, height: topHeight },
                    'eaten-left': { x: leftPocketCenterX - pocketRadius, y: pocketY - pocketRadius, width: pocketRadius * 2, height: pocketRadius * 2, isArc: true },
                    'escaped-right': { x: rightBoundary - 60, y: junctionY, width: 60, height: topHeight },
                    'eaten-right': { x: rightPocketCenterX - pocketRadius, y: pocketY - pocketRadius, width: pocketRadius * 2, height: pocketRadius * 2, isArc: true }
                };

                // Highlight the correct answer zone
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
                        
                        if (Math.random() < probability) {
                            bug.actualOutcome = `eaten-${bug.direction}`;
                        } else {
                            bug.actualOutcome = `escaped-${bug.direction}`;
                        }
                        
                        trial_data.bug_direction = bug.direction;
                        trial_data.actual_outcome = bug.actualOutcome;
                    }
                } else {
                    // Determine if the bug is in a danger zone. This check happens on every frame.
                    const wasInDangerZone = bug.isInDangerZone;
                    const leftDangerZone = { start: leftPocketCenterX - pocketRadius, end: leftPocketCenterX + pocketRadius };
                    const rightDangerZone = { start: rightPocketCenterX - pocketRadius, end: rightPocketCenterX + pocketRadius };
                    const inLeftZone = bug.direction === 'left' && bug.x < leftDangerZone.end && bug.x > leftDangerZone.start;
                    const inRightZone = bug.direction === 'right' && bug.x > rightDangerZone.start && bug.x < rightDangerZone.end;
                    bug.isInDangerZone = inLeftZone || inRightZone;

                    // This 'if' block ONLY runs when the state changes, which is perfect for updating audio and speed.
                    if (wasInDangerZone !== bug.isInDangerZone) {
                        bug.speed = bug.isInDangerZone ? bug.fastSpeed : bug.normalSpeed;
                        updateAudio();
                    }

                    // This movement logic is now OUTSIDE the 'if' block and runs on every frame, as it should.
                    bug.x += (bug.direction === 'left' ? -1 : 1) * bug.speed;

                    // Check if the trial should end. This also runs on every frame.
                    if (bug.actualOutcome.startsWith('eaten')) {
                        const stopX = bug.direction === 'left' ? leftPocketCenterX : rightPocketCenterX;
                        if ((bug.direction === 'left' && bug.x <= stopX) || (bug.direction === 'right' && bug.x >= stopX)) {
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
                        
                        // Show miss feedback
                        gameState = 'feedback';
                        ctx.clearRect(0, 0, canvas.width, canvas.height);
                        drawTMaze();
                        drawPredatorPockets();
                        
                        ctx.font = '700 24px serif';
                        ctx.textAlign = 'center';
                        ctx.fillStyle = colors.incorrectFeedback;
                        ctx.fillText('Miss', canvas.width / 2, mazeY - 30);
                        
                        setTimeout(() => finishTrial(), 1500);
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
                    // Define clickable zones
                    const zones = {
                        'escaped-left': { x: leftBoundary, y: junctionY, width: 60, height: topHeight },
                        'eaten-left': { x: leftPocketCenterX - pocketRadius, y: pocketY - pocketRadius, 
                                      width: pocketRadius * 2, height: pocketRadius * 2 },
                        'escaped-right': { x: rightBoundary - 60, y: junctionY, width: 60, height: topHeight },
                        'eaten-right': { x: rightPocketCenterX - pocketRadius, y: pocketY - pocketRadius, 
                                       width: pocketRadius * 2, height: pocketRadius * 2 }
                    };

                    for (const [outcome, zone] of Object.entries(zones)) {
                        if (x >= zone.x && x <= zone.x + zone.width && 
                            y >= zone.y && y <= zone.y + zone.height) {
                            clearTimeout(responseTimer);
                            trial_data.user_choice = outcome;
                            trial_data.correct = (outcome === bug.actualOutcome);
                            trial_data.rt = performance.now() - clickTime;
                            
                            // Show feedback
                            gameState = 'feedback';
                            ctx.clearRect(0, 0, canvas.width, canvas.height);
                            drawTMaze();
                            drawPredatorPockets();
                            
                            ctx.font = '700 24px serif';
                            ctx.textAlign = 'center';
                            ctx.fillStyle = trial_data.correct ? colors.correctFeedback : colors.incorrectFeedback;
                            ctx.fillText(trial_data.correct ? 'Correct!' : 'Incorrect!', canvas.width / 2, mazeY - 30);
                            
                            // Show the correct zone highlighted
                            if (trial_data.correct) {
                                ctx.save();
                                ctx.globalAlpha = 0.5;
                                ctx.fillStyle = colors.correctFeedback;
                                
                                if (outcome.startsWith('escaped')) {
                                    ctx.fillRect(zone.x, zone.y, zone.width, zone.height);
                                } else {
                                    ctx.beginPath();
                                    ctx.arc(zone.x + pocketRadius, zone.y + pocketRadius, pocketRadius, 0, Math.PI, false);
                                    ctx.fill();
                                }
                                ctx.restore();
                            } else {
                                // Show the correct answer
                                const correctZones = {
                                    'escaped-left': { x: leftBoundary, y: junctionY, width: 60, height: topHeight },
                                    'eaten-left': { x: leftPocketCenterX - pocketRadius, y: pocketY - pocketRadius, 
                                                  width: pocketRadius * 2, height: pocketRadius * 2 },
                                    'escaped-right': { x: rightBoundary - 60, y: junctionY, width: 60, height: topHeight },
                                    'eaten-right': { x: rightPocketCenterX - pocketRadius, y: pocketY - pocketRadius, 
                                                   width: pocketRadius * 2, height: pocketRadius * 2 }
                                };
                                
                                const correctZone = correctZones[bug.actualOutcome];
                                if (correctZone) {
                                    ctx.save();
                                    ctx.globalAlpha = 0.5;
                                    ctx.fillStyle = colors.correctFeedback;
                                    
                                    if (bug.actualOutcome.startsWith('escaped')) {
                                        ctx.fillRect(correctZone.x, correctZone.y, correctZone.width, correctZone.height);
                                    } else {
                                        ctx.beginPath();
                                        ctx.arc(correctZone.x + pocketRadius, correctZone.y + pocketRadius, pocketRadius, 0, Math.PI, false);
                                        ctx.fill();
                                    }
                                    ctx.restore();
                                }
                            }
                            gameState = 'feedback';
                            setTimeout(() => finishTrial(), 1500);
                            break;
                        }
                    }
                }
            }

            const finishTrial = () => {
                // FIXED: Ensure complete cleanup
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
                
                // Clear the display element
                display_element.innerHTML = '';
                
                // Finish the trial
                plugin.jsPsych.finishTrial(trial_data);
            }

            // Start the trial
            canvas.addEventListener('click', handleClick);
            render();
        }
    }

    TMazePluginClass.info = info;
    return TMazePluginClass;
})(jsPsych);

// Function to set up audio context (must be called after a user gesture)
function setupAudio() {
    if (isAudioInitialized) return;
    
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }
        
        // FIXED: Create initial nodes
        gainNode = audioContext.createGain();
        biquadFilter = audioContext.createBiquadFilter();
        gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
        
        // Don't connect them globally - let each trial handle its own connections
        
        isAudioInitialized = true;
    } catch(e) {
        console.warn('Audio initialization failed:', e);
        isAudioInitialized = false;
    }
}

// Welcome screen
const welcome_trial = {
    type: jsPsychHtmlButtonResponse,
    stimulus: '<h1 style="font-family: serif; color: #5d4037;">Halassa Lab\'s Beetle Burrow T-Maze</h1><p style="font-size: 18px;">Welcome to the experiment!</p>',
    choices: ['Begin'],
    on_finish: function() {
        // This is the crucial step to initialize audio after the user's first click.
        setupAudio();
    }
};

// Instructions
const instructions = {
    type: jsPsychInstructions,
    pages: [
        `<div style="background: rgba(255, 255, 255, 0.95); padding: 50px; border-radius: 20px; max-width: 800px; margin: auto;">
            <h1 style="color: #5d4037;">Instructions</h1>
            <p><strong>Goal:</strong> Your objective is to predict the outcome of a beetle's journey through a maze.</p>
            <p><strong>How it works:</strong></p>
            <ul style="text-align: left;">
                <li>In each trial, a beetle will start at the bottom of the maze and run upwards.</li>
                <li>At the top, it will turn either left or right before disappearing from view.</li>
                <li>At the end of each arm, there is a predator. Different beetles have different survival rates against different predators.</li>
                <li>The beetle will either be <strong>eaten</strong> by the predator or <strong>escape</strong> past it.</li>
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

// Add a preload trial to load all image assets before the experiment starts
const preload = {
    type: jsPsychPreload,
    images: ['red_bug.png', 'blue_bug.png', 'Pink.png', 'Orange.png', 'Yellow.png'],
    message: '<p>Loading resources...</p>'
};

// Phase transition messages
function createPhaseTransition(message) {
    return {
        type: jsPsychHtmlButtonResponse,
        stimulus: `<div style="background: rgba(255, 255, 255, 0.98); padding: 50px; border-radius: 15px; box-shadow: 0 10px 40px rgba(139, 90, 43, 0.3);">
            <h2 style="font-family: serif; color: #5d4037;">${message}</h2>
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
timeline.push(preload); // Add the preload trial to the timeline

// Function to check performance and advance phases
function checkPerformance() {
  const phaseData = jsPsych.data.get().filter({ phase: currentPhase }).values();
  if (currentPhase < 4 && phaseData.length >= 10) {
    const last10 = phaseData.slice(-10);
    const correct = last10.filter(t => t.correct).length;

    if (correct >= 6) {
      // advance phase number & choose message
      currentPhase += 1;
      const msg =
        currentPhase === 2 ? "A new bug has entered the tree!" :
        currentPhase === 3 ? "This tree now has both bugs!"   :
                             "Training complete – full run!";
      
      timeline.push(createPhaseTransition(msg));
      timeline.push(main_trial);   // <-- add another trial loop
      return true;                  // break out of current loop
    }
  }
  return false;                     // keep running current loop
}


// Create main trial loop
const main_trial = {
    timeline: [
        {
            type: TMazePlugin,
            bug_type: function() {
                if (currentPhase === 1) return firstBugType;
                if (currentPhase === 2) return secondBugType;
                // Ensure bug types match the image names used
                return Math.random() < 0.5 ? 'red_orange_beetle' : 'blue_beetle';
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
        
        // Check if phase 4 is complete (40 trials)
        if (currentPhase === 4) {
            const phase4Data = jsPsych.data.get().filter({phase: 4}).values();
            if (phase4Data.length >= 40) {
                return false; // End experiment
            }
        }
        
        return true; // Continue trials
    }
};

// Add main trial loop
timeline.push(main_trial);

// End screen
timeline.push({
    type: jsPsychHtmlButtonResponse,
    stimulus: '<h1 style="font-family: serif; color: #5d4037;">Thank You!</h1><p>The experiment is complete. Your data has been saved.</p>',
    choices: ['Download Data (CSV)'],
    on_finish: function() {
        // Save data
        const data = jsPsych.data.get().csv();
        const blob = new Blob([data], {type: 'text/csv'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'tmaze_data.csv';
        a.click();
    }
});

// Run the experiment
jsPsych.run(timeline);