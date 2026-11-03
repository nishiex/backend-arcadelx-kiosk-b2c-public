pipeline {
    agent any

    options {
        timestamps()
        disableConcurrentBuilds()
    }

    environment {
        COMPOSE_PROJECT_NAME = 'arcadelx-kiosk'
    }

    stages {
        stage('Prepare environment') {
            steps {
                withCredentials([file(credentialsId: 'arcadelx-env', variable: 'APP_ENV_FILE')]) {
                    sh 'install -m 600 "$APP_ENV_FILE" .env'
                }
                sh 'docker compose config -q'
            }
        }

        stage('Build images') {
            steps {
                sh 'docker compose build --pull api web'
            }
        }

        stage('Deploy') {
            steps {
                sh '''
                    old_api="$(docker ps -aq --filter label=com.docker.compose.project=arcadelx --filter label=com.docker.compose.service=api)"
                    old_web="$(docker ps -aq --filter label=com.docker.compose.project=arcadelx --filter label=com.docker.compose.service=web)"
                    if [ -n "$old_api" ]; then docker rm -f $old_api; fi
                    if [ -n "$old_web" ]; then docker rm -f $old_web; fi
                '''
                sh 'docker compose up -d --remove-orphans api web redis'
            }
        }

        stage('Verify') {
            steps {
                sh 'docker compose ps'
                sh 'curl --fail --retry 12 --retry-delay 2 http://127.0.0.1:4000/health'
                sh 'curl --fail --retry 12 --retry-delay 2 http://127.0.0.1:3000/login >/dev/null'
            }
        }
    }

    post {
        always {
            sh 'rm -f .env'
        }
    }
}
