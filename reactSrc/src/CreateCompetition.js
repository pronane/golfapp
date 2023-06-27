import React, { useState, useEffect, useContext } from "react";
import { makeStyles } from "@material-ui/core/styles";
import {
  Container,
  Typography,
  TextField,
  Button,
  Grid,
  TableContainer,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Paper,
  MenuItem,
  ButtonGroup,
} from "@material-ui/core";
import axios from "axios";
import { apiUrl } from "./config";
import { useHistory } from "react-router-dom";
import { AuthContext } from "./AuthStateProvider";

const useStyles = makeStyles((theme) => ({
  paper: {
    marginTop: theme.spacing(8),
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },
  form: {
    width: "100%",
    marginTop: theme.spacing(3),
  },
  submit: {
    margin: theme.spacing(3, 0, 2),
  },
  table: {
    marginTop: theme.spacing(3),
  },
}));

export default function CompetitionPage() {
  const [name, setName] = useState("");
  const [competitionType, setCompetitionType] = useState(undefined); // Initialize as undefined
  const [competitionTypes, setCompetitionTypes] = useState([]);
  const [competitions, setCompetitions] = useState([]);
  const classes = useStyles();
  const history = useHistory();

  const { fetchWithAuth } = useContext(AuthContext);

  useEffect(() => {
    // Fetch competition types
    axios
      .get(`${apiUrl}/competition/competition-type`)
      .then((response) => {
        console.log("response.data " + response.data);
        setCompetitionTypes(response.data);
      })
      .catch((error) => {
        console.error("Error fetching competition types:", error);
      });

    // Fetch existing competitions
    axios
      .get(`${apiUrl}/competition/user/1`)
      .then((response) => {
        setCompetitions(response.data);
      })
      .catch((error) => {
        console.error("Error fetching competitions:", error);
      });
  }, []);

  const handleCompetitionTypeChange = (e) => {
    setCompetitionType(e.target.value);
  };

  const handleNewCompetitionNameChange = (e) => {
    setName(e.target.value);
  };

  const handleCreateCompetition = () => {
    const newCompetition = {
      name: name,
      competitionType: competitionType,
    };

    axios
      .post(`${apiUrl}/competition/create`, newCompetition)
      .then((response) => {
        setCompetitions([...competitions, response.data]);
        setName("");
        setCompetitionType(undefined);
      })
      .catch((error) => {
        console.error("Error creating competition:", error);
      });
  };

  const handleEdit = (competitionId) => {
    setCompetitions((prevCompetitions) =>
      prevCompetitions.map((competition) => {
        if (competition.id === competitionId) {
          return { ...competition, isEditable: true };
        }
        return competition;
      })
    );
  };

  const handleNameChange = (e, competitionId) => {
    const newName = e.target.value;
    setCompetitions((prevCompetitions) =>
      prevCompetitions.map((competition) => {
        if (competition.id === competitionId) {
          return { ...competition, name: newName };
        }
        return competition;
      })
    );
  };

  const handleTypeChange = (e, competitionId) => {
    const newType = e.target.value;
    setCompetitions((prevCompetitions) =>
      prevCompetitions.map((competition) => {
        if (competition.id === competitionId) {
          return { ...competition, competitionType: newType };
        }
        return competition;
      })
    );
  };

  const handleUpdate = (competitionId) => {
    const updatedCompetition = competitions.find(
      (competition) => competition.id === competitionId
    );

    axios
      .put(`${apiUrl}/competition/update/${competitionId}`, updatedCompetition)
      .then(() => {
        setCompetitions((prevCompetitions) =>
          prevCompetitions.map((competition) => {
            if (competition.id === competitionId) {
              return { ...competition, isEditable: false };
            }
            return competition;
          })
        );
      })
      .catch((error) => {
        console.error("Error updating competition:", error);
      });
  };

  const handleDelete = (competitionId) => {
    axios
      .delete(`${apiUrl}/competition/delete/${competitionId}`)
      .then(() => {
        setCompetitions((prevCompetitions) =>
          prevCompetitions.filter(
            (competition) => competition.id !== competitionId
          )
        );
      })
      .catch((error) => {
        console.error("Error deleting competition:", error);
      });
  };

  const handleViewEvents = (competitionId) => {
    const selectedCompetition = competitions.find(
      (competition) => competition.id === competitionId
    );
    if (selectedCompetition) {
      history.push("/viewcompetitionevents", {
        competitionId: selectedCompetition.id,
        competitionName: selectedCompetition.name,
      });
    }
  };

  return (
    <Container component="main" maxWidth="md">
      <div className={classes.paper}>
        <Typography component="h1" variant="h5">
          Create Competition
        </Typography>
        <form className={classes.form} noValidate>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <TextField
                variant="outlined"
                required
                fullWidth
                id="name"
                label="Competition Name"
                name="name"
                value={name}
                onChange={handleNewCompetitionNameChange}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                select
                variant="outlined"
                required
                fullWidth
                id="competitionType"
                label="Competition Type"
                name="competitionType"
                value={competitionType || ""} // Render empty string if undefined
                onChange={handleCompetitionTypeChange}
              >
                {competitionTypes.map((type) => (
                  <MenuItem key={type} value={type}>
                    {type}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
          </Grid>
          <Button
            fullWidth
            variant="contained"
            color="primary"
            className={classes.submit}
            onClick={handleCreateCompetition}
          >
            Create
          </Button>
        </form>

        <TableContainer component={Paper}>
          <Table className={classes.table} aria-label="competitions table">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Action</TableCell>
                <TableCell>Events</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {competitions.map((competition) => (
                <TableRow key={competition.id}>
                  <TableCell>
                    {competition.isEditable ? (
                      <TextField
                        value={competition.name}
                        onChange={(e) => handleNameChange(e, competition.id)}
                      />
                    ) : (
                      competition.name
                    )}
                  </TableCell>
                  <TableCell>
                    {competition.isEditable ? (
                      <TextField
                        select
                        value={competition.competitionType}
                        onChange={(e) => handleTypeChange(e, competition.id)}
                      >
                        {competitionTypes.map((type) => (
                          <MenuItem key={type} value={type}>
                            {type}
                          </MenuItem>
                        ))}
                      </TextField>
                    ) : (
                      competition.competitionType
                    )}
                  </TableCell>
                  <TableCell>
                    {competition.isEditable ? (
                      <ButtonGroup>
                        <Button
                          variant="contained"
                          color="primary"
                          onClick={() => handleUpdate(competition.id)}
                        >
                          Save
                        </Button>
                        <Button
                          variant="contained"
                          color="secondary"
                          onClick={() => {
                            handleUpdate(competition.id);
                            setCompetitions((prevCompetitions) =>
                              prevCompetitions.map((comp) => {
                                if (comp.id === competition.id) {
                                  return { ...comp, isEditable: false };
                                }
                                return comp;
                              })
                            );
                          }}
                        >
                          Cancel
                        </Button>
                      </ButtonGroup>
                    ) : (
                      <Button
                        variant="contained"
                        color="primary"
                        onClick={() => handleEdit(competition.id)}
                      >
                        Edit
                      </Button>
                    )}
                    <Button
                      variant="contained"
                      color="secondary"
                      onClick={() => handleDelete(competition.id)}
                    >
                      Delete
                    </Button>
                  </TableCell>
                  <TableCell>
                    {" "}
                    {/* New column */}
                    <Button
                      color="primary"
                      onClick={() => handleViewEvents(competition.id)}
                    >
                      View Events
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </div>
    </Container>
  );
}
