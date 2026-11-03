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
