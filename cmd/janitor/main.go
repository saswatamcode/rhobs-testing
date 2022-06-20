package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/credentials"
	"github.com/aws/aws-sdk-go/aws/session"
	"github.com/aws/aws-sdk-go/service/s3"
	"github.com/aws/aws-sdk-go/service/s3/s3manager"

	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	ctrl "sigs.k8s.io/controller-runtime"
)

type statefulSet struct {
	Name        string `json:"name"`
	Namespace   string `json:"namespace"`
	WaitMinutes *int   `json:"waitMinutes,omitempty"`
}

type awsConfig struct {
	Region     string `json:"region"`
	BucketName string `json:"bucketName"`
	SecretKey  string `json:"secretKey"`
	AccessKey  string `json:"accessKey"`
}

type config struct {
	StatefulSets []statefulSet `json:"statefulsets"`
	AwsConfig    *awsConfig    `json:"awsConfig"`
}

func main() {
	var configFile string
	flag.StringVar(&configFile, "config", "", "Path to the config file")
	flag.Parse()

	ctx := context.TODO()
	cfg := mustGetConfig(configFile)

	if len(cfg.StatefulSets) > 0 {
		if err := cleanStatefulSetsState(ctx, mustGetK8sClient(), cfg.StatefulSets); err != nil {
			log.Fatal(err)
		}
		log.Println("state removed")
	}

	if cfg.AwsConfig != nil {
		if err := cleanBucket(ctx, mustGetAWS3Client(cfg.AwsConfig), cfg.AwsConfig.BucketName); err != nil {
			log.Fatal(err)
		}
		log.Println("bucket cleaned")
	}
}

func cleanStatefulSetsState(ctx context.Context, k8Client *kubernetes.Clientset, sts []statefulSet) error {
	for _, s := range sts {
		ss, err := k8Client.AppsV1().StatefulSets(s.Namespace).Get(ctx, s.Name, metav1.GetOptions{})
		if err != nil {
			return err
		}

		current := *ss.DeepCopy().Spec.Replicas
		ss.Spec.Replicas = aws.Int32(0)

		if _, err := k8Client.AppsV1().StatefulSets(s.Namespace).Update(ctx, ss, metav1.UpdateOptions{}); err != nil {
			return err
		}

		for _, pvc := range ss.Spec.VolumeClaimTemplates {
			for i := current - 1; i > -1; i-- {
				if err := k8Client.CoreV1().PersistentVolumeClaims(s.Namespace).Delete(ctx, fmt.Sprintf("%s-%s-%d", pvc.Name, ss.Name, i), metav1.DeleteOptions{}); err != nil {
					if !errors.IsNotFound(err) {
						return err
					}
				}
			}
		}

		if s.WaitMinutes != nil && *s.WaitMinutes > 0 {
			ctx, _ = context.WithDeadline(ctx, time.Now().Add(time.Duration(*s.WaitMinutes)*time.Minute))

			select {
			case <-time.After(30 * time.Second):
				ss, _ := k8Client.AppsV1().StatefulSets(s.Namespace).Get(ctx, s.Name, metav1.GetOptions{})
				if ss != nil && *ss.Spec.Replicas == 0 {
					log.Printf("sts %s has zero replicas", s.Name)
					break
				}
			case <-ctx.Done():
				return fmt.Errorf("failed to scale sts before deadline")
			}
		}
	}
	return nil
}

func cleanBucket(ctx context.Context, client *s3.S3, bucketName string) error {
	iter := s3manager.NewDeleteListIterator(client, &s3.ListObjectsInput{
		Bucket: aws.String(bucketName),
	})

	return s3manager.NewBatchDeleteWithClient(client).Delete(ctx, iter)
}

func mustGetConfig(path string) *config {
	f, err := os.Open(path)
	if err != nil {
		panic(err)
	}
	defer f.Close()
	cfg := config{}

	if err := json.NewDecoder(f).Decode(&cfg); err != nil {
		panic(err)
	}
	return &cfg
}

func mustGetAWS3Client(cfg *awsConfig) *s3.S3 {
	sess := session.Must(
		session.NewSession(
			&aws.Config{
				Region:      aws.String(cfg.Region),
				Credentials: credentials.NewStaticCredentials(cfg.AccessKey, cfg.SecretKey, ""),
			},
		))
	return s3.New(sess)
}

func mustGetK8sClient() *kubernetes.Clientset {
	config := ctrl.GetConfigOrDie()
	return kubernetes.NewForConfigOrDie(config)
}
