import React, { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import LoadingSpinner from '../components/LoadingSpinner';

/** Legacy route — output links now live as a tab on the channel detail page. */
const ChannelOutputsPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    if (!id) {
      navigate('/channels', { replace: true });
      return;
    }
    navigate(`/channels/${id}?tab=outputs`, { replace: true });
  }, [id, navigate]);

  return (
    <Layout>
      <LoadingSpinner />
    </Layout>
  );
};

export default ChannelOutputsPage;
